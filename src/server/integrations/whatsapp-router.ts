import type {
  Person,
  WhatsAppConversation,
  WhatsAppFlow,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { extractIntakeFields } from '@/server/agents/intake-ocr/extract';
import { classifyIntent } from '@/server/agents/intent/classify';
import { parseTimesheetText } from '@/server/agents/intent/timesheet';
import { parseAvailabilityText } from '@/server/agents/intent/availability';
import {
  signPrefillToken,
  newPrefillJti,
  WHATSAPP_PREFILL_TTL_SECONDS,
} from '@/server/agents/assistant/prefill/token';
import { createPrefillDispatch } from '@/server/whatsapp-prefill-dispatch';
import { startOfWeek, formatIsoDate } from '@/lib/week';
import { optionalEnv } from '@/server/env';
import { downloadWhatsAppMedia, sendWhatsAppText } from './whatsapp';

/**
 * WhatsApp prefill parity (TASK-302c).
 *
 * After 302c, the timesheet / expense flows reply with a one-time
 * signed deep-link to the prefilled web form instead of auto-writing
 * a draft DB row. The user taps the link on their phone's browser,
 * reviews the populated form, and submits via the form's normal flow
 * (capability checks + validation live there).
 *
 * The legacy auto-draft behaviour stays available behind the
 * `WHATSAPP_AUTO_WRITE_DRAFTS=1` env var. If TT decides phone-first
 * folks prefer the auto-draft round-trip, flip it back on per-flow.
 * Default off after this task.
 */
function legacyAutoDraftEnabled(): boolean {
  return optionalEnv('WHATSAPP_AUTO_WRITE_DRAFTS') === '1';
}

function publicAppUrl(): string {
  return optionalEnv('NEXT_PUBLIC_APP_URL') ?? 'https://ops.foundry.health';
}

/**
 * WhatsApp conversation router.
 *
 * Flow detection via Claude (claude-haiku per CLAUDE.md A4 — fast +
 * cheap routing) when the user is idle; once a flow is active we keep
 * threading multi-turn until the flow completes or the user types
 * "cancel" / "menu".
 *
 * Supported flows:
 *   - timesheet      — log hours against a project for a date
 *   - availability   — set hours for upcoming weekdays
 *   - expense        — submit a receipt photo + description
 *   - status_check   — what hours did I log this week, etc.
 *
 * State stored in `WhatsAppConversation.state` as JSON. Each flow's
 * handler advances the state field-by-field, asking one question per
 * turn so it works on a small phone screen.
 *
 * Mutating actions (creating Expense / TimesheetEntry / availability
 * forecast) are audited under `actor: { type: 'agent', id: 'whatsapp-router' }`
 * so the trail still attributes them to the user (via session.person)
 * but tags the entry as agent-mediated.
 */

export type IncomingMessage = {
  /** Provider message id (Meta's wamid) — used to dedupe re-deliveries. */
  providerId: string;
  fromPhone: string; // E.164 with leading "+"
  receivedAt: Date;
  /** Free-text body (when type=text). */
  text: string | null;
  /** Image / document / audio media id when applicable. */
  mediaId: string | null;
  mediaMimeType: string | null;
};

// Intent classification + timesheet/availability extraction live in
// src/server/agents/intent/ so the in-app assistant (TASK-301) and this
// WhatsApp router share the same extractors. See classify.ts /
// timesheet.ts / availability.ts.

const HELP_TEXT = `Hi! I can help with:
• *Timesheet* — say "log 4 hours on PROJ001 today" → I send a 1-tap link to a prefilled timesheet
• *Availability* — say "I'm available 8h Mon–Fri next week"
• *Expense* — send a receipt photo + (optional) project code → I OCR it and send a prefilled expense link
• *Status* — ask "how many hours this week"
Tap-to-submit links last 24 hours. Type *cancel* anytime to abort.`;

/**
 * Resolve the inbound phone to a Person. Strips spaces / dashes and
 * tries E.164 match on `whatsappNumber`. Returns null when unknown so
 * the caller can reply "we don't recognise this number" without leaking
 * any data.
 */
async function resolvePerson(fromPhone: string): Promise<Person | null> {
  const normalised = fromPhone.replace(/[\s\-()]/g, '');
  const variants = [normalised];
  if (!normalised.startsWith('+')) variants.push(`+${normalised}`);
  const person = await prisma.person.findFirst({
    where: {
      whatsappNumber: { in: variants },
      endDate: null,
    },
  });
  return person;
}

/**
 * Ensure the conversation row exists for this person, returning the
 * current row.
 */
async function ensureConversation(
  personId: string,
): Promise<WhatsAppConversation> {
  return prisma.whatsAppConversation.upsert({
    where: { personId },
    create: { personId, flow: 'idle' },
    update: { lastInboundAt: new Date() },
  });
}

async function setFlow(
  conversationId: string,
  flow: WhatsAppFlow,
  state: Prisma.InputJsonValue | null,
): Promise<void> {
  await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: {
      flow,
      state: state === null ? Prisma.DbNull : state,
    },
  });
}

async function logMessage(opts: {
  conversationId: string;
  direction: 'inbound' | 'outbound';
  providerId?: string | null;
  fromPhone?: string | null;
  toPhone?: string | null;
  body: string;
  mediaId?: string | null;
  resultEntityType?: string | null;
  resultEntityId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await prisma.whatsAppMessage.create({
    data: {
      conversationId: opts.conversationId,
      direction: opts.direction,
      providerId: opts.providerId ?? null,
      fromPhone: opts.fromPhone ?? null,
      toPhone: opts.toPhone ?? null,
      body: opts.body,
      mediaId: opts.mediaId ?? null,
      resultEntityType: opts.resultEntityType ?? null,
      resultEntityId: opts.resultEntityId ?? null,
      errorMessage: opts.errorMessage ?? null,
    },
  });
}

async function reply(
  conversationId: string,
  toPhone: string,
  body: string,
  resultEntityType?: string | null,
  resultEntityId?: string | null,
): Promise<void> {
  let providerId: string | null = null;
  let errorMessage: string | null = null;
  try {
    providerId = await sendWhatsAppText(toPhone, body);
    await prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { lastOutboundAt: new Date() },
    });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'send failed';
    console.error('[whatsapp.reply]', errorMessage);
  }
  await logMessage({
    conversationId,
    direction: 'outbound',
    providerId,
    toPhone,
    body,
    resultEntityType,
    resultEntityId,
    errorMessage,
  });
}

// ─── Flow handlers ────────────────────────────────────────────────────

async function handleTimesheet(
  person: Person,
  conversation: WhatsAppConversation,
  message: IncomingMessage,
): Promise<void> {
  const text = message.text ?? '';
  const todayIso = new Date().toISOString().slice(0, 10);
  const result = await parseTimesheetText(text, todayIso);
  if (!result.ok) {
    await reply(conversation.id, message.fromPhone, result.error);
    return;
  }
  const parsed = result.data;
  // Resolve the project by code.
  const project = await prisma.project.findUnique({
    where: { code: parsed.projectCode.toUpperCase() },
    select: { id: true, code: true, name: true, stage: true },
  });
  if (!project) {
    await reply(
      conversation.id,
      message.fromPhone,
      `I don't see a project with code *${parsed.projectCode}*. Try the project's exact code.`,
    );
    return;
  }
  if (project.stage === 'archived') {
    await reply(
      conversation.id,
      message.fromPhone,
      `*${project.code}* is archived — can't log time against it.`,
    );
    return;
  }

  const date = new Date(`${parsed.dateIso}T00:00:00.000Z`);

  if (legacyAutoDraftEnabled()) {
    // ─── Legacy path — auto-write the draft entry (pre-302c) ──────
    const created = await prisma.$transaction(async (tx) => {
      const entry = await tx.timesheetEntry.create({
        data: {
          personId: person.id,
          projectId: project.id,
          date,
          hours: new Prisma.Decimal(parsed.hours),
          description: parsed.description ?? null,
          status: 'draft',
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: person.id },
        action: 'created',
        entity: {
          type: 'timesheet_entry',
          id: entry.id,
          after: {
            via: 'whatsapp',
            projectCode: project.code,
            hours: parsed.hours,
            dateIso: parsed.dateIso,
          },
        },
        source: 'agent',
      });
      return entry;
    });
    await setFlow(conversation.id, 'idle', null);
    await reply(
      conversation.id,
      message.fromPhone,
      `✅ Logged *${parsed.hours}h* on *${project.code}* for ${parsed.dateIso} (draft). Review and submit on the web when ready.`,
      'timesheet_entry',
      created.id,
    );
    return;
  }

  // ─── Prefill path (default after TASK-302c) ──────────────────────
  // Build a signed prefill token + reply with a deep-link to the
  // form. The user taps the link, lands on /timesheet with the row
  // populated and the "Prefilled by Assistant" banner, and submits
  // via the form's normal flow. No timesheet row is written here — only
  // a dispatch-tracking row (below) so the reminder cron can nudge them
  // to finish (TASK-128).
  const prefillJti = newPrefillJti();
  const prefillSentMs = Date.now();
  const token = signPrefillToken({
    kind: 'timesheet',
    personId: person.id,
    ttlSeconds: WHATSAPP_PREFILL_TTL_SECONDS,
    jti: prefillJti,
    payload: {
      entries: [
        {
          projectCode: project.code,
          dateIso: parsed.dateIso,
          hours: parsed.hours,
          notes: parsed.description ?? null,
        },
      ],
    },
  });
  const weekIso = formatIsoDate(startOfWeek(date));
  const url = `${publicAppUrl()}/timesheet?week=${weekIso}&prefill=${encodeURIComponent(token)}`;

  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: { type: 'person', id: person.id },
      action: 'minted',
      entity: {
        type: 'assistant_prefill',
        id: `${person.id}:whatsapp-timesheet:${parsed.dateIso}`,
        after: {
          channel: 'whatsapp',
          kind: 'timesheet',
          projectCode: project.code,
          hours: parsed.hours,
          dateIso: parsed.dateIso,
        },
      },
      source: 'agent',
    });
  });
  await createPrefillDispatch({
    personId: person.id,
    whatsappNumber: message.fromPhone,
    kind: 'timesheet',
    linkUrl: url,
    jti: prefillJti,
    expiresAt: new Date(prefillSentMs + WHATSAPP_PREFILL_TTL_SECONDS * 1000),
    projectCode: project.code,
    entryDateIso: parsed.dateIso,
    hours: parsed.hours,
  });
  await setFlow(conversation.id, 'idle', null);
  await reply(
    conversation.id,
    message.fromPhone,
    `📝 Prepped *${parsed.hours}h* on *${project.code}* for ${parsed.dateIso}.
Tap to review + submit (link valid 24h):
${url}`,
    'assistant_prefill',
    null,
  );
}

async function handleAvailability(
  person: Person,
  conversation: WhatsAppConversation,
  message: IncomingMessage,
): Promise<void> {
  const text = message.text ?? '';
  const today = new Date();
  const thisMonday = startOfWeek(today);
  const nextMonday = new Date(thisMonday.getTime() + 7 * 24 * 3600 * 1000);
  const result = await parseAvailabilityText(
    text,
    thisMonday.toISOString().slice(0, 10),
    nextMonday.toISOString().slice(0, 10),
  );
  if (!result.ok) {
    await reply(conversation.id, message.fromPhone, result.error);
    return;
  }
  const parsed = result.data;
  const dows: Array<{ key: keyof typeof parsed.hoursByDow; offset: number }> = [
    { key: 'mon', offset: 0 },
    { key: 'tue', offset: 1 },
    { key: 'wed', offset: 2 },
    { key: 'thu', offset: 3 },
    { key: 'fri', offset: 4 },
    { key: 'sat', offset: 5 },
    { key: 'sun', offset: 6 },
  ];
  const weekStart = new Date(`${parsed.weekStartIso}T00:00:00.000Z`);
  let written = 0;
  await prisma.$transaction(async (tx) => {
    for (const d of dows) {
      const date = new Date(weekStart.getTime() + d.offset * 24 * 3600 * 1000);
      const hours = parsed.hoursByDow[d.key] ?? 0;
      await tx.availabilityForecast.upsert({
        where: { personId_date: { personId: person.id, date } },
        create: {
          personId: person.id,
          date,
          hours: Math.round(hours),
          notes: parsed.notes ?? null,
        },
        update: { hours: Math.round(hours), notes: parsed.notes ?? null },
      });
      if (hours > 0) written += 1;
    }
    await writeAudit(tx, {
      actor: { type: 'person', id: person.id },
      action: 'updated',
      entity: {
        type: 'person',
        id: person.id,
        after: {
          via: 'whatsapp_availability',
          weekStart: parsed.weekStartIso,
          hours: parsed.hoursByDow,
        },
      },
      source: 'agent',
    });
  });
  await setFlow(conversation.id, 'idle', null);
  const total = Object.values(parsed.hoursByDow).reduce(
    (s, h) => s + (h ?? 0),
    0,
  );
  await reply(
    conversation.id,
    message.fromPhone,
    `✅ Forecast saved for week of ${parsed.weekStartIso}: *${total}h* across ${written} day${written === 1 ? '' : 's'}.`,
  );
}

/**
 * Expense flow — when an image arrives, run the receipt OCR pipeline,
 * create an Expense in pending_review status, and reply with a summary.
 * If only text arrived, ask for the receipt photo.
 */
async function handleExpense(
  person: Person,
  conversation: WhatsAppConversation,
  message: IncomingMessage,
): Promise<void> {
  if (!message.mediaId) {
    await reply(
      conversation.id,
      message.fromPhone,
      'Send the receipt photo and I\'ll create the expense. Add the project code in the caption (e.g. "PROJ001 — flight").',
    );
    return;
  }
  const media = await downloadWhatsAppMedia(message.mediaId);
  if (!media) {
    await reply(
      conversation.id,
      message.fromPhone,
      'WhatsApp integration not fully configured for media — sorry.',
    );
    return;
  }
  // Run OCR.
  const extracted = await extractIntakeFields({
    base64: media.buffer.toString('base64'),
    mimeType: media.mimeType,
    fileName: `wa-${message.providerId}.bin`,
  });

  // Try to pull a project code out of the caption (text accompanying
  // the image), fall back to the first matching code in the receipt's
  // vendor field if any. Otherwise leave projectId null and the staff
  // member can attach later via the web app.
  const captionUpper = (message.text ?? '').toUpperCase();
  const codeMatch = captionUpper.match(/[A-Z]{2,5}\d{2,5}/);
  let projectId: string | null = null;
  let projectCode: string | null = null;
  if (codeMatch) {
    const found = await prisma.project.findUnique({
      where: { code: codeMatch[0] },
      select: { id: true, code: true, stage: true },
    });
    if (found && found.stage !== 'archived') {
      projectId = found.id;
      projectCode = found.code;
    }
  }

  const totalDollars = extracted.ok
    ? extracted.data.amountTotalDollars ?? 0
    : 0;
  const gstDollars = extracted.ok ? extracted.data.gstDollars ?? 0 : 0;
  const vendor = extracted.ok ? extracted.data.supplierName ?? '' : '';
  const dateIso =
    extracted.ok && extracted.data.issueDate
      ? extracted.data.issueDate
      : new Date().toISOString().slice(0, 10);

  if (legacyAutoDraftEnabled()) {
    // ─── Legacy path — auto-write a submitted Expense (pre-302c) ──
    const expense = await prisma.$transaction(async (tx) => {
      const e = await tx.expense.create({
        data: {
          personId: person.id,
          projectId,
          date: new Date(`${dateIso}T00:00:00.000Z`),
          vendor: vendor || 'Unknown vendor',
          category: 'other',
          amount: Math.round(totalDollars * 100),
          gst: Math.round(gstDollars * 100),
          description: message.text ?? null,
          status: 'submitted',
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: person.id },
        action: 'created',
        entity: {
          type: 'expense',
          id: e.id,
          after: {
            via: 'whatsapp',
            mediaId: message.mediaId,
            ocrConfigured: extracted.ok,
            extracted: extracted.ok ? extracted.data : null,
            projectCode,
          },
        },
        source: 'agent',
      });
      return e;
    });
    await setFlow(conversation.id, 'idle', null);
    const ocrSuffix = extracted.ok
      ? `Detected vendor *${vendor || '—'}*, total *$${totalDollars.toFixed(2)}* on *${dateIso}*.`
      : 'OCR not configured — I\'ve saved the receipt for manual review.';
    const projectLine = projectCode
      ? `Tagged to project *${projectCode}*.`
      : 'No project code detected — attach one via the web app.';
    await reply(
      conversation.id,
      message.fromPhone,
      `📸 Receipt logged → expense pending review.
${ocrSuffix}
${projectLine}`,
      'expense',
      expense.id,
    );
    return;
  }

  // ─── Prefill path (default after TASK-302c) ──────────────────────
  if (!extracted.ok) {
    // No structured data to put in a prefill — let the user know
    // and ask them to try /expenses/new manually.
    await setFlow(conversation.id, 'idle', null);
    await reply(
      conversation.id,
      message.fromPhone,
      `📸 Got the receipt but couldn't read it (${extracted.reason}). Try logging it manually at ${publicAppUrl()}/expenses/new.`,
    );
    return;
  }

  // Build a prefill_expense token from the OCR result. Description
  // falls back to the user's caption when present, otherwise a
  // placeholder so the form's required-description rule is satisfied.
  const description =
    message.text && message.text.trim().length > 0
      ? message.text.trim()
      : `Receipt · ${vendor || 'unknown vendor'} · ${dateIso}`;
  const prefillJti = newPrefillJti();
  const prefillSentMs = Date.now();
  const token = signPrefillToken({
    kind: 'expense',
    personId: person.id,
    ttlSeconds: WHATSAPP_PREFILL_TTL_SECONDS,
    jti: prefillJti,
    payload: {
      dateIso,
      amountDollars: totalDollars,
      gstDollars: gstDollars > 0 ? gstDollars : null,
      // The intake-ocr extractor uses the same canonical category enum
      // as the form — pass through when the model returned one;
      // otherwise default to 'other' (user can re-pick on the form).
      category: extracted.data.category ?? 'other',
      vendor: vendor || null,
      description,
      projectCode: projectCode ?? null,
    },
  });
  const url = `${publicAppUrl()}/expenses/new?prefill=${encodeURIComponent(token)}`;

  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: { type: 'person', id: person.id },
      action: 'minted',
      entity: {
        type: 'assistant_prefill',
        id: `${person.id}:whatsapp-expense:${dateIso}`,
        after: {
          channel: 'whatsapp',
          kind: 'expense',
          ocrConfidence: extracted.data.confidence.overall,
          projectCode,
          vendor,
          totalDollars,
        },
      },
      source: 'agent',
    });
  });
  await createPrefillDispatch({
    personId: person.id,
    whatsappNumber: message.fromPhone,
    kind: 'expense',
    linkUrl: url,
    jti: prefillJti,
    expiresAt: new Date(prefillSentMs + WHATSAPP_PREFILL_TTL_SECONDS * 1000),
    entryDateIso: dateIso,
    amountCents: Math.round(totalDollars * 100),
  });
  await setFlow(conversation.id, 'idle', null);
  const projectLine = projectCode
    ? `· Tagged to project *${projectCode}*`
    : '· OPEX (no project)';
  await reply(
    conversation.id,
    message.fromPhone,
    `📸 Read *${vendor || 'receipt'}* · *$${totalDollars.toFixed(2)}* on ${dateIso} ${projectLine}.
Tap to review + submit (link valid 24h):
${url}`,
    'assistant_prefill',
    null,
  );
}

async function handleStatusCheck(
  person: Person,
  conversation: WhatsAppConversation,
  message: IncomingMessage,
): Promise<void> {
  const today = new Date();
  const monday = startOfWeek(today);
  const sunday = new Date(monday.getTime() + 7 * 24 * 3600 * 1000);
  const entries = await prisma.timesheetEntry.findMany({
    where: {
      personId: person.id,
      date: { gte: monday, lt: sunday },
    },
    select: { hours: true, status: true },
  });
  const total = entries.reduce((s, e) => s + Number(e.hours), 0);
  const draft = entries.filter((e) => e.status === 'draft').length;
  await setFlow(conversation.id, 'idle', null);
  await reply(
    conversation.id,
    message.fromPhone,
    `📊 This week so far: *${total.toFixed(1)}h* logged across ${entries.length} entries${draft > 0 ? ` (${draft} still draft)` : ''}.`,
  );
}

// ─── Unknown sender ───────────────────────────────────────────────────

/**
 * Copy sent back to a sender we can't match to an active Person.
 * Deliberately generic: it must not confirm or deny who is registered
 * (the number could be a wrong-number stranger, not a teammate), while
 * still telling a real teammate what to do. Kept as a pure function so
 * it's unit-testable without the DB.
 */
export function unknownSenderReply(): string {
  return `👋 Thanks for messaging Foundry Ops. I don't recognise this number, so I can't action anything yet.
If you're on the team, ask an admin to add your WhatsApp number (in *+61…* format) to your profile in the Directory — then message me again.`;
}

/**
 * Handle an inbound from a phone that matches no active Person. These
 * used to be dropped in total silence — no reply, no log — which to a
 * sender looked like the agent was broken (and gave admins no trail of
 * who tried). Now we:
 *   1. record the attempt as a *system* AuditEvent (actorId is a Person
 *      FK, so an unknown sender can't be the actor) keyed on the wamid so
 *      Meta re-deliveries don't double-log, and
 *   2. send one generic bounce-back. We're allowed to reply because the
 *      sender messaged us first (inside Meta's 24h service window).
 */
async function handleUnknownSender(message: IncomingMessage): Promise<void> {
  // Dedupe Meta re-deliveries of the same wamid so a retried delivery
  // doesn't double-audit or double-reply. Uses the
  // (entityType, entityId) index on AuditEvent.
  if (message.providerId) {
    const seen = await prisma.auditEvent.findFirst({
      where: { entityType: 'whatsapp_inbound', entityId: message.providerId },
      select: { id: true },
    });
    if (seen) return;
  }
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: { type: 'system' },
      action: 'rejected',
      entity: {
        type: 'whatsapp_inbound',
        id: message.providerId || message.fromPhone,
        after: {
          reason: 'unknown_sender',
          fromPhone: message.fromPhone,
          hadMedia: message.mediaId !== null,
          textPreview: message.text ? message.text.slice(0, 80) : null,
        },
      },
      source: 'agent',
    });
  });
  try {
    await sendWhatsAppText(message.fromPhone, unknownSenderReply());
  } catch (err) {
    console.error('[whatsapp.unknownSender] bounce-back failed:', err);
  }
}

// ─── Top-level dispatcher ─────────────────────────────────────────────

export async function handleIncomingWhatsAppMessage(
  message: IncomingMessage,
): Promise<{ ok: boolean; reason?: string }> {
  const person = await resolvePerson(message.fromPhone);
  if (!person) {
    await handleUnknownSender(message);
    return { ok: false, reason: 'unknown sender' };
  }
  if (person.endDate !== null) {
    return { ok: false, reason: 'archived person' };
  }
  if (person.inactiveAt !== null) {
    // Polite refuse — the inactive flag disables all input surfaces.
    // No DB write so the conversation row isn't even created.
    return { ok: false, reason: 'inactive' };
  }

  // Dedupe Meta re-deliveries. The webhook awaits slow work (media
  // download + OCR) before returning 200, so a slow first attempt can
  // exceed Meta's delivery timeout and get retried with the SAME wamid.
  // Without this guard the retry would OCR again and send a second
  // prefill link / write duplicate rows. If we've already logged this
  // inbound providerId, treat the re-delivery as a no-op. (Best-effort:
  // not fully race-proof against near-simultaneous retries — a unique
  // index on WhatsAppMessage.providerId would harden it; see TASKS.md.)
  if (message.providerId) {
    const alreadyProcessed = await prisma.whatsAppMessage.findFirst({
      where: { providerId: message.providerId, direction: 'inbound' },
      select: { id: true },
    });
    if (alreadyProcessed) {
      return { ok: true, reason: 'duplicate delivery — skipped' };
    }
  }

  const conversation = await ensureConversation(person.id);
  await logMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    providerId: message.providerId,
    fromPhone: message.fromPhone,
    body: message.text ?? '[media]',
    mediaId: message.mediaId,
  });

  // If the message has media and no active flow, treat as expense.
  let activeFlow: WhatsAppFlow = conversation.flow;
  if (activeFlow === 'idle') {
    if (message.mediaId) {
      activeFlow = 'expense';
    } else {
      const text = (message.text ?? '').trim();
      const intent = await classifyIntent(text);
      switch (intent) {
        case 'menu':
          await reply(conversation.id, message.fromPhone, HELP_TEXT);
          return { ok: true };
        case 'cancel':
          await setFlow(conversation.id, 'idle', null);
          await reply(
            conversation.id,
            message.fromPhone,
            'Cancelled. Type *menu* anytime for options.',
          );
          return { ok: true };
        case 'unknown':
          await reply(
            conversation.id,
            message.fromPhone,
            `Not sure what you mean. ${HELP_TEXT}`,
          );
          return { ok: true };
        case 'timesheet':
          activeFlow = 'timesheet';
          break;
        case 'availability':
          activeFlow = 'availability';
          break;
        case 'expense':
          activeFlow = 'expense';
          break;
        case 'status_check':
          activeFlow = 'status_check';
          break;
      }
    }
  }

  // `activeFlow` can no longer be 'idle' here — every idle-branch code
  // path above either returned early or reassigned to a flow.
  switch (activeFlow) {
    case 'timesheet':
      await handleTimesheet(person, conversation, message);
      break;
    case 'availability':
      await handleAvailability(person, conversation, message);
      break;
    case 'expense':
      await handleExpense(person, conversation, message);
      break;
    case 'status_check':
      await handleStatusCheck(person, conversation, message);
      break;
  }
  return { ok: true };
}
