import { prisma } from '@/server/db';
import { startOfWeek, addDays, todayInFirmTz } from '@/lib/week';

/**
 * "What does the staff member owe right now?" — a tight read of the
 * actions a consultant is most likely to need to clear today. Drives
 * the dashboard's StaffOutstandingCard so the worker opens the app
 * and sees a checklist instead of a feed.
 *
 * Signals (in priority order):
 *   1. **Last week's timesheet not submitted** — by Monday of the
 *      current week, the previous week's hours should be in. We flag
 *      every previous week (up to 4 back) that still has draft or
 *      missing entries.
 *   2. **Expenses awaiting your action** — `draft` status (uploaded
 *      via receipt-intake but never finalised) OR `rejected` status
 *      (needs your resubmission with a fix).
 *   3. **This week's timesheet is empty** — soft nudge if it's
 *      Wednesday+ and they haven't logged any hours yet.
 *
 * Read-only. The card just links the staff member to the right place
 * to act; the actions themselves stay where they live (/timesheet,
 * /expenses/[id], etc.) so we don't fork the data-entry surface.
 */

export type StaffPendingAction = {
  kind:
    | 'timesheet_overdue'
    | 'timesheet_empty_midweek'
    | 'expense_draft'
    | 'expense_rejected';
  /** One-line label rendered as the action's headline. */
  title: string;
  /** Sub-line — context (week range, expense vendor + amount, etc.). */
  detail: string;
  /** Where to send the user to act on this row. */
  href: string;
  /** Visual urgency. Red = past-due / blocked, amber = nudge, blue = info. */
  tone: 'red' | 'amber' | 'blue';
};

export async function listStaffPendingActions(
  personId: string,
): Promise<StaffPendingAction[]> {
  const out: StaffPendingAction[] = [];

  // ── 1+3. Timesheet signals ────────────────────────────────────
  const now = new Date();
  const thisMonday = startOfWeek(todayInFirmTz());
  // Walk back 4 weeks looking for un-submitted blocks. Skip the
  // current week from the "overdue" check — that's a "this week"
  // signal, not a past-due one.
  const fourWeeksAgo = addDays(thisMonday, -28);
  const [recentEntries, personRow] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { personId, date: { gte: fourWeeksAgo } },
      select: { date: true, status: true, hours: true },
    }),
    // startDate bounds the empty-week check — a new joiner shouldn't
    // be told they missed weeks before they existed.
    prisma.person.findUnique({
      where: { id: personId },
      select: { startDate: true },
    }),
  ]);
  const personStart = personRow?.startDate ?? null;
  type WeekBucket = {
    weekStart: Date;
    hours: number;
    hasDraft: boolean;
    hasSubmitted: boolean;
  };
  const weekMap = new Map<string, WeekBucket>();
  for (const e of recentEntries) {
    const monday = startOfWeek(e.date);
    const key = monday.toISOString().slice(0, 10);
    const cur = weekMap.get(key) ?? {
      weekStart: monday,
      hours: 0,
      hasDraft: false,
      hasSubmitted: false,
    };
    cur.hours += Number(e.hours);
    if (e.status === 'draft') cur.hasDraft = true;
    if (e.status === 'submitted' || e.status === 'approved' || e.status === 'billed') {
      cur.hasSubmitted = true;
    }
    weekMap.set(key, cur);
  }
  // Overdue: any prior week with draft entries that haven't been
  // submitted, OR a prior week that's completely missing (no entries
  // at all — could be a leave week but we surface it anyway and let
  // the staffer dismiss by submitting "0 hours" or similar).
  for (let i = 1; i <= 4; i += 1) {
    const wkStart = addDays(thisMonday, -7 * i);
    const key = wkStart.toISOString().slice(0, 10);
    const bucket = weekMap.get(key);
    const weekEnd = addDays(wkStart, 6);
    if (bucket?.hasDraft) {
      out.push({
        kind: 'timesheet_overdue',
        title: `Timesheet for ${formatWeekRange(wkStart, weekEnd)} still draft`,
        detail: `${bucket.hours.toFixed(1)}h logged but not submitted. Submit for approval.`,
        href: `/timesheet?week=${key}&view=week`,
        tone: 'red',
      });
      // Only surface the most recent overdue week — older ones are
      // visible in the timesheet approval-history card already.
      break;
    }
    // Completely-empty prior week — the most common miss (someone who
    // never opened the timesheet at all). Previously only draft-but-
    // unsubmitted weeks fired, so a fully-skipped week showed
    // "You're all clear". Weeks before the person's start date don't
    // count.
    const startedByThisWeek =
      personStart === null || personStart.getTime() <= weekEnd.getTime();
    if (startedByThisWeek && (!bucket || (!bucket.hasSubmitted && bucket.hours === 0))) {
      out.push({
        kind: 'timesheet_overdue',
        title: `No hours logged for ${formatWeekRange(wkStart, weekEnd)}`,
        detail: 'Log the week (or enter 0h for leave) so resourcing stays accurate.',
        href: `/timesheet?week=${key}&view=week`,
        tone: 'red',
      });
      break;
    }
  }
  // This-week nudge: if today is Wednesday or later AND this week's
  // total is 0, surface a soft reminder. Skips weekend logins —
  // Sunday/Saturday are when most people catch up.
  const dow = now.getDay(); // 0=Sun..6=Sat
  if (dow >= 3 && dow <= 5) {
    const thisKey = thisMonday.toISOString().slice(0, 10);
    const thisBucket = weekMap.get(thisKey);
    if (!thisBucket || thisBucket.hours === 0) {
      out.push({
        kind: 'timesheet_empty_midweek',
        title: "Nothing logged this week yet",
        detail: 'Catch up on hours so the resourcing view stays accurate.',
        href: '/timesheet?view=week',
        tone: 'amber',
      });
    }
  }

  // ── 2. Expenses needing action ────────────────────────────────
  const myExpenses = await prisma.expense.findMany({
    where: {
      personId,
      status: { in: ['draft', 'rejected'] },
    },
    orderBy: { date: 'desc' },
    take: 10,
    select: {
      id: true,
      vendor: true,
      amount: true,
      status: true,
      date: true,
      category: true,
    },
  });
  for (const e of myExpenses) {
    // Vendor can be null on receipts the OCR agent hasn't extracted
    // a supplier name for yet — fall back to a readable placeholder
    // so the action title doesn't render "Finalise expense · null".
    const vendorLabel = e.vendor?.trim() || 'Untitled receipt';
    if (e.status === 'draft') {
      out.push({
        kind: 'expense_draft',
        title: `Finalise expense · ${vendorLabel}`,
        detail: `${formatMoney(e.amount)} · ${e.category} · uploaded ${e.date.toLocaleDateString('en-AU')}`,
        href: `/expenses/${e.id}`,
        tone: 'amber',
      });
    } else if (e.status === 'rejected') {
      out.push({
        kind: 'expense_rejected',
        title: `Expense rejected · ${vendorLabel}`,
        detail: `${formatMoney(e.amount)} — open to see the reason and resubmit.`,
        href: `/expenses/${e.id}`,
        tone: 'red',
      });
    }
  }

  // Stable priority order: rejected (red) > overdue (red) > drafts
  // (amber) > nudges (amber). Sort by tone then by kind so the list
  // reads top-down by urgency.
  const tonePriority = { red: 0, amber: 1, blue: 2 } as const;
  out.sort((a, b) => tonePriority[a.tone] - tonePriority[b.tone]);
  return out;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatWeekRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = start.toLocaleDateString('en-AU', {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
  });
  const endLabel = end.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });
  return `${startLabel}–${endLabel}`;
}
