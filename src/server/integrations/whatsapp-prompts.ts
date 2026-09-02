import { prisma } from '@/server/db';
import { startOfWeek, addDays } from '@/lib/week';
import { sendWhatsAppText, isWhatsAppConfigured } from './whatsapp';

/**
 * Outbound nudges. Two flavours:
 *
 *   - **Daily timesheet reminder** — every weekday afternoon, ping any
 *     active staff member whose timesheet for the day still has zero
 *     hours logged. Skip on weekends and on inactive / archived people.
 *   - **Weekly availability prompt** — every Sunday evening, ping
 *     permanent staff to confirm next week's availability if no
 *     forecast cells are stored yet.
 *
 * Idempotent — checks `WhatsAppMessage` for the same prompt body sent
 * within the last 18 hours so re-running the scheduler doesn't double-
 * nudge. Returns counts so the caller (cron / admin trigger) can log.
 */

async function ensureConversationFor(personId: string): Promise<string> {
  const conv = await prisma.whatsAppConversation.upsert({
    where: { personId },
    create: { personId, flow: 'idle' },
    update: {},
    select: { id: true },
  });
  return conv.id;
}

async function recentlyPrompted(
  conversationId: string,
  body: string,
  windowHours = 18,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
  const existing = await prisma.whatsAppMessage.findFirst({
    where: {
      conversationId,
      direction: 'outbound',
      receivedAt: { gte: cutoff },
      body,
    },
    select: { id: true },
  });
  return existing !== null;
}

async function send(
  personId: string,
  toPhone: string,
  body: string,
): Promise<boolean> {
  const conversationId = await ensureConversationFor(personId);
  if (await recentlyPrompted(conversationId, body)) return false;
  let providerId: string | null = null;
  let errorMessage: string | null = null;
  try {
    providerId = await sendWhatsAppText(toPhone, body);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'send failed';
    console.error('[whatsapp.prompt]', errorMessage);
  }
  await prisma.whatsAppMessage.create({
    data: {
      conversationId,
      direction: 'outbound',
      providerId,
      toPhone,
      body,
      errorMessage,
    },
  });
  await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { lastOutboundAt: new Date() },
  });
  return errorMessage === null;
}

export async function sendDailyTimesheetPrompts(): Promise<{
  sent: number;
  skipped: number;
}> {
  if (!isWhatsAppConfigured()) return { sent: 0, skipped: 0 };
  const now = new Date();
  const dow = now.getDay();
  // Skip weekends — Meta charges per business-message session, no
  // value in pinging staff who aren't working.
  if (dow === 0 || dow === 6) return { sent: 0, skipped: 0 };
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const tomorrow = addDays(todayStart, 1);
  const candidates = await prisma.person.findMany({
    where: {
      endDate: null,
      inactiveAt: null,
      isStaff: true,
      whatsappNumber: { not: null },
    },
    select: { id: true, firstName: true, whatsappNumber: true },
  });
  let sent = 0;
  let skipped = 0;
  for (const p of candidates) {
    if (!p.whatsappNumber) {
      skipped += 1;
      continue;
    }
    const loggedToday = await prisma.timesheetEntry.findFirst({
      where: {
        personId: p.id,
        date: { gte: todayStart, lt: tomorrow },
      },
      select: { id: true },
    });
    if (loggedToday) {
      skipped += 1;
      continue;
    }
    const ok = await send(
      p.id,
      p.whatsappNumber,
      `Hey ${p.firstName} — quick reminder: nothing logged on the timesheet for today yet. Reply with e.g. "log 4h on PROJ001 today" and I'll draft it for you.`,
    );
    if (ok) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}

export async function sendWeeklyAvailabilityPrompts(): Promise<{
  sent: number;
  skipped: number;
}> {
  if (!isWhatsAppConfigured()) return { sent: 0, skipped: 0 };
  const now = new Date();
  const thisMonday = startOfWeek(now);
  const nextMonday = addDays(thisMonday, 7);
  const followingMonday = addDays(nextMonday, 7);

  const candidates = await prisma.person.findMany({
    where: {
      endDate: null,
      inactiveAt: null,
      isStaff: true,
      whatsappNumber: { not: null },
    },
    select: { id: true, firstName: true, whatsappNumber: true },
  });
  let sent = 0;
  let skipped = 0;
  for (const p of candidates) {
    if (!p.whatsappNumber) {
      skipped += 1;
      continue;
    }
    const filled = await prisma.availabilityForecast.findFirst({
      where: {
        personId: p.id,
        date: { gte: nextMonday, lt: followingMonday },
      },
      select: { id: true },
    });
    if (filled) {
      skipped += 1;
      continue;
    }
    const ok = await send(
      p.id,
      p.whatsappNumber,
      `Hi ${p.firstName} — what's your availability for next week? Reply with e.g. "8h Mon–Fri next week" or "Tue 4h, Wed 8h, Thu 8h".`,
    );
    if (ok) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}

// ─── Timesheet approval-loop notices ────────────────────────────────────
//
// Two directions, both best-effort side-channels on top of the in-app
// UserUpdate feed (which stays the source of truth):
//
//   submitter → approver : "someone's timesheet needs your decision"
//   approver  → submitter: "your timesheet was approved / sent back"
//
// Both reuse `send()` above, so every outbound lands in WhatsAppMessage
// (auditable) and the 18h identical-body dedupe stops a double-tap on
// Approve from double-pinging. Callers fire these AFTER their DB
// transaction commits and never await the result — a WhatsApp outage
// must not roll back an approval.

const APP_BASE_URL =
  process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://ops.foundry.health';

/**
 * Body text for the submitter's decision DM. Pure so the wording is
 * testable without a Meta round-trip. `note` carries the approver's
 * reject reason — the whole point of the message on a send-back, so
 * it's inlined rather than left behind in the app.
 */
export function buildTimesheetDecisionWhatsApp(opts: {
  firstName: string;
  decision: 'approved' | 'rejected';
  entryCount: number;
  totalHours: number;
  approverName: string;
  note?: string | null;
  appBaseUrl: string;
}): string {
  const entryLabel = `${opts.entryCount} ${opts.entryCount === 1 ? 'entry' : 'entries'}`;
  const hours = opts.totalHours.toFixed(1);
  if (opts.decision === 'approved') {
    return (
      `Hi ${opts.firstName} — your timesheet has been approved by ${opts.approverName} ` +
      `(${entryLabel} · ${hours}h). Those hours are now posted to project P&L.` +
      (opts.note ? `\n\nNote: ${opts.note}` : '') +
      `\n\n${opts.appBaseUrl}/timesheet`
    );
  }
  return (
    `Hi ${opts.firstName} — ${opts.approverName} sent ${entryLabel} (${hours}h) on your ` +
    `timesheet back to draft, so they need another look.` +
    (opts.note ? `\n\nReason: ${opts.note}` : '') +
    `\n\nFix and resubmit: ${opts.appBaseUrl}/timesheet`
  );
}

/**
 * Body text for a contractor's "your month closed, invoice us" DM.
 *
 * Deliberately does NOT say Foundry has raised an invoice — it hasn't.
 * The contractor issues their own (D1, TT 2026-08-31); this points them at a
 * pre-filled draft they check, number, and submit. Getting that wording
 * right matters: telling a contractor we've invoiced on their behalf would
 * describe an RCTI arrangement that doesn't exist.
 */
export function buildContractorInvoiceReadyWhatsApp(opts: {
  firstName: string;
  monthLabel: string;
  hours: number;
  amountExGstCents: number;
  appBaseUrl: string;
}): string {
  return (
    `Hi ${opts.firstName} — your ${opts.monthLabel} timesheet is fully approved ` +
    `(${opts.hours.toFixed(1)}h). We've pre-filled an invoice for ` +
    `$${(opts.amountExGstCents / 100).toFixed(2)} ex GST — add your invoice number ` +
    `and submit it when you're ready.` +
    `\n\n${opts.appBaseUrl}/me/invoices`
  );
}

export async function sendContractorInvoiceReadyNotice(opts: {
  personId: string;
  monthLabel: string;
  hours: number;
  amountExGstCents: number;
}): Promise<boolean> {
  if (!isWhatsAppConfigured()) return false;
  const person = await prisma.person.findUnique({
    where: { id: opts.personId },
    select: { firstName: true, whatsappNumber: true, endDate: true },
  });
  if (!person?.whatsappNumber || person.endDate) return false;
  return send(
    opts.personId,
    person.whatsappNumber,
    buildContractorInvoiceReadyWhatsApp({
      firstName: person.firstName,
      monthLabel: opts.monthLabel,
      hours: opts.hours,
      amountExGstCents: opts.amountExGstCents,
      appBaseUrl: APP_BASE_URL,
    }),
  );
}

/**
 * Body text for an approver's "there's a timesheet waiting" DM.
 */
export function buildTimesheetApprovalQueueWhatsApp(opts: {
  firstName: string;
  submitterName: string;
  entryCount: number;
  totalHours: number;
  weekLabel: string;
  appBaseUrl: string;
}): string {
  const entryLabel = `${opts.entryCount} ${opts.entryCount === 1 ? 'entry' : 'entries'}`;
  return (
    `Hi ${opts.firstName} — ${opts.submitterName} submitted a timesheet for your approval: ` +
    `${entryLabel} · ${opts.totalHours.toFixed(1)}h, week of ${opts.weekLabel}.` +
    `\n\nApprove or send back: ${opts.appBaseUrl}/timesheet/approve`
  );
}

/**
 * DM the submitter that their timesheet was decided.
 */
export async function sendTimesheetDecisionNotice(opts: {
  personId: string;
  decision: 'approved' | 'rejected';
  entryCount: number;
  totalHours: number;
  approverName: string;
  note?: string | null;
}): Promise<boolean> {
  if (!isWhatsAppConfigured()) return false;
  const person = await prisma.person.findUnique({
    where: { id: opts.personId },
    select: { firstName: true, whatsappNumber: true, endDate: true },
  });
  if (!person?.whatsappNumber || person.endDate) return false;
  return send(
    opts.personId,
    person.whatsappNumber,
    buildTimesheetDecisionWhatsApp({
      firstName: person.firstName,
      decision: opts.decision,
      entryCount: opts.entryCount,
      totalHours: opts.totalHours,
      approverName: opts.approverName,
      note: opts.note ?? null,
      appBaseUrl: APP_BASE_URL,
    }),
  );
}

/**
 * DM every approver that a submitted timesheet is sitting in their
 * queue. `approverIds` is resolved by the caller (super-admins + admins
 * see everything; managers / partners only their own projects) so this
 * function stays free of permission logic.
 */
export async function sendTimesheetApprovalQueueNotice(opts: {
  approverIds: string[];
  submitterName: string;
  entryCount: number;
  totalHours: number;
  weekLabel: string;
}): Promise<{ sent: number; skipped: number }> {
  if (!isWhatsAppConfigured() || opts.approverIds.length === 0) {
    return { sent: 0, skipped: 0 };
  }
  const approvers = await prisma.person.findMany({
    where: {
      id: { in: opts.approverIds },
      endDate: null,
      whatsappNumber: { not: null },
    },
    select: { id: true, firstName: true, whatsappNumber: true },
  });
  let sent = 0;
  let skipped = 0;
  for (const a of approvers) {
    if (!a.whatsappNumber) {
      skipped += 1;
      continue;
    }
    const ok = await send(
      a.id,
      a.whatsappNumber,
      buildTimesheetApprovalQueueWhatsApp({
        firstName: a.firstName,
        submitterName: opts.submitterName,
        entryCount: opts.entryCount,
        totalHours: opts.totalHours,
        weekLabel: opts.weekLabel,
        appBaseUrl: APP_BASE_URL,
      }),
    );
    if (ok) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}
