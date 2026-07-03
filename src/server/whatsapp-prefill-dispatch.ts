import { prisma } from '@/server/db';

/**
 * Tracking + reminder logic for WhatsApp prefill deep-links (TASK-128).
 *
 * When the WhatsApp router sends a prefill link, it records a dispatch
 * row here. A cron then nudges people who haven't finished: an early
 * reminder a few hours after send, and a last-call shortly before the
 * 24h link expiry. "Finished" is detected by checking whether the target
 * record now exists (a timesheet entry / expense matching the payload) —
 * so no hook on the web form submit is needed.
 *
 * Reply-to-confirm (submitting straight from WhatsApp) is deliberately
 * out of scope here — deferred to a later pass with DB verification.
 */

/** Fire the early reminder once the link has been outstanding this long. */
export const EARLY_REMINDER_AFTER_SECONDS = 3 * 60 * 60; // 3h
/** Fire the last-call reminder once within this window before expiry. */
export const LAST_CALL_BEFORE_EXPIRY_SECONDS = 4 * 60 * 60; // ~20h in on a 24h link

export type ReminderKind = 'early' | 'lastcall';

/** The lifecycle fields the reminder decision depends on. */
export type DispatchReminderState = {
  sentAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  earlyReminderAt: Date | null;
  lastCallReminderAt: Date | null;
};

/**
 * Which reminder (if any) is due for a dispatch right now. Pure.
 *
 *  - completed or expired → nothing.
 *  - inside the last-call window and last-call not yet sent → 'lastcall'
 *    (takes priority — it's the final chance before the link dies).
 *  - past the early threshold and early not yet sent → 'early'.
 *  - otherwise → null.
 */
export function dueReminder(
  d: DispatchReminderState,
  now: Date,
): ReminderKind | null {
  if (d.completedAt) return null;
  const nowMs = now.getTime();
  if (nowMs >= d.expiresAt.getTime()) return null; // too late — link dead

  const lastCallOpensMs =
    d.expiresAt.getTime() - LAST_CALL_BEFORE_EXPIRY_SECONDS * 1000;
  // Inside the final window it's last-call or nothing — the early nudge is
  // a *pre-window* prompt and would read as noise this close to expiry.
  if (nowMs >= lastCallOpensMs) {
    return d.lastCallReminderAt ? null : 'lastcall';
  }

  const earlyOpensMs = d.sentAt.getTime() + EARLY_REMINDER_AFTER_SECONDS * 1000;
  if (nowMs >= earlyOpensMs && !d.earlyReminderAt) return 'early';

  return null;
}

// ─── DB wrappers ──────────────────────────────────────────────────────

export type CreateDispatchInput = {
  personId: string;
  whatsappNumber: string;
  kind: 'timesheet' | 'expense';
  linkUrl: string;
  jti: string;
  expiresAt: Date;
  /** timesheet completion-check fields */
  projectCode?: string | null;
  entryDateIso?: string | null;
  hours?: number | null;
  /** expense completion-check field (AUD cents, inc GST) */
  amountCents?: number | null;
};

export async function createPrefillDispatch(
  input: CreateDispatchInput,
): Promise<void> {
  // Best-effort: this row only powers the reminder cron. It must NEVER
  // break the core flow (the user still gets their prefill link). If the
  // write fails — e.g. the migration hasn't been applied to this
  // environment yet — log and carry on; the only cost is no reminder.
  try {
    await prisma.whatsAppPrefillDispatch.create({
      data: {
        personId: input.personId,
        whatsappNumber: input.whatsappNumber,
        kind: input.kind,
        linkUrl: input.linkUrl,
        jti: input.jti,
        expiresAt: input.expiresAt,
        projectCode: input.projectCode ?? null,
        entryDateIso: input.entryDateIso ?? null,
        hours: input.hours ?? null,
        amountCents:
          input.amountCents != null ? BigInt(input.amountCents) : null,
      },
    });
  } catch (err) {
    console.error('[whatsapp-prefill-dispatch] create failed (non-fatal):', err);
  }
}

/** Active = not completed and not yet expired. The cron's work list. */
export function listActiveDispatches(now: Date) {
  return prisma.whatsAppPrefillDispatch.findMany({
    where: { completedAt: null, expiresAt: { gt: now } },
    orderBy: { sentAt: 'asc' },
  });
}

/** The person's most recent still-open prefill link — what a WhatsApp
 *  `CONFIRM` reply applies (TASK-129). Null when nothing is pending. */
export function findLatestOutstandingDispatch(personId: string, now: Date) {
  return prisma.whatsAppPrefillDispatch.findFirst({
    where: { personId, completedAt: null, expiresAt: { gt: now } },
    orderBy: { sentAt: 'desc' },
  });
}

/** Pull the signed `prefill` token out of a stored dispatch link. The
 *  token carries the full, person-bound payload, so CONFIRM can apply it
 *  without re-deriving anything. Pure. Null if there's no prefill param. */
export function extractPrefillTokenFromUrl(linkUrl: string): string | null {
  const q = linkUrl.indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(linkUrl.slice(q + 1)).get('prefill');
}

export async function markDispatchCompleted(id: string, now: Date): Promise<void> {
  await prisma.whatsAppPrefillDispatch.update({
    where: { id },
    data: { completedAt: now },
  });
}

export async function stampReminderSent(
  id: string,
  kind: ReminderKind,
  now: Date,
): Promise<void> {
  await prisma.whatsAppPrefillDispatch.update({
    where: { id },
    data:
      kind === 'early' ? { earlyReminderAt: now } : { lastCallReminderAt: now },
  });
}

/**
 * Has the person already logged the thing this link was for? Used to
 * mark a dispatch complete (and skip nagging) without a form-submit hook.
 * Deliberately loose: a matching timesheet entry / expense on the same
 * person+date is "done enough" to stop reminding.
 */
export async function targetRecordExists(dispatch: {
  kind: string;
  personId: string;
  projectCode: string | null;
  entryDateIso: string | null;
  amountCents: bigint | null;
}): Promise<boolean> {
  if (!dispatch.entryDateIso) return false;
  const date = new Date(`${dispatch.entryDateIso}T00:00:00.000Z`);

  if (dispatch.kind === 'timesheet') {
    if (!dispatch.projectCode) return false;
    const project = await prisma.project.findUnique({
      where: { code: dispatch.projectCode.toUpperCase() },
      select: { id: true },
    });
    if (!project) return false;
    const entry = await prisma.timesheetEntry.findFirst({
      where: { personId: dispatch.personId, projectId: project.id, date },
      select: { id: true },
    });
    return entry != null;
  }

  if (dispatch.kind === 'expense') {
    const expense = await prisma.expense.findFirst({
      where: {
        personId: dispatch.personId,
        date,
        ...(dispatch.amountCents != null
          ? { amount: Number(dispatch.amountCents) }
          : {}),
      },
      select: { id: true },
    });
    return expense != null;
  }

  return false;
}

/** Reminder copy — repeats the link, coaches around the in-app-browser
 *  trap (the whole reason for the nudge), and offers the browser-free
 *  reply-to-confirm fallback (TASK-129). */
export function reminderMessage(
  dispatch: { kind: string; linkUrl: string },
  which: ReminderKind,
): string {
  const what = dispatch.kind === 'expense' ? 'expense' : 'timesheet entry';
  const lead =
    which === 'lastcall'
      ? `⏰ Last chance — the link to finish your ${what} expires soon.`
      : `👋 You started a ${what} but haven't submitted it yet.`;
  return (
    `${lead}\n\nTap to review + submit:\n${dispatch.linkUrl}\n\n` +
    `If the link won't open, open it in your phone's browser (Safari or ` +
    `Chrome) rather than the in-app WhatsApp preview — or just reply ` +
    `*CONFIRM* and I'll submit it for you.`
  );
}
