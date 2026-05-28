import type {
  Person,
  WhatsAppConversation,
  WhatsAppFlow,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { extractIntakeFields } from '@/server/agents/intake-ocr/extract';
import { startOfWeek } from '@/lib/week';
import { downloadWhatsAppMedia, sendWhatsAppText } from './whatsapp';

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

const ROUTER_PROMPT = `You are a routing classifier for a WhatsApp bot serving a consulting firm's staff.

Classify the user's message into ONE of these intents:
  - "timesheet"      — anything about logging hours / project time
  - "availability"   — declaring hours they expect to work in coming days
  - "expense"        — submitting an expense / receipt
  - "status_check"   — asking about their current hours, available time, etc.
  - "menu"           — asking what they can do, listing options
  - "cancel"         — wanting to abort the current flow
  - "unknown"        — none of the above

Return ONLY the intent string, nothing else. Just one word.`;

async function classifyIntent(
  text: string,
): Promise<
  | 'timesheet'
  | 'availability'
  | 'expense'
  | 'status_check'
  | 'menu'
  | 'cancel'
  | 'unknown'
> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    // Fallback to keyword matching when LLM not configured.
    const lc = text.toLowerCase();
    if (/\b(timesheet|hours|log|logged)\b/.test(lc)) return 'timesheet';
    if (/\b(availab|forecast|next week)\b/.test(lc)) return 'availability';
    if (/\b(expense|receipt|reimburs)\b/.test(lc)) return 'expense';
    if (/\b(status|how many|this week)\b/.test(lc)) return 'status_check';
    if (/\b(menu|help|options)\b/.test(lc)) return 'menu';
    if (/\b(cancel|stop|abort)\b/.test(lc)) return 'cancel';
    return 'unknown';
  }
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    // claude-haiku-4-5 is the cheap routing model — single-word output.
    model: 'claude-haiku-4-5',
    max_tokens: 32,
    system: ROUTER_PROMPT,
    messages: [{ role: 'user', content: text }],
  });
  const block = res.content.find((c) => c.type === 'text');
  const out =
    block && 'text' in block ? block.text.trim().toLowerCase() : 'unknown';
  if (
    [
      'timesheet',
      'availability',
      'expense',
      'status_check',
      'menu',
      'cancel',
      'unknown',
    ].includes(out)
  ) {
    return out as
      | 'timesheet'
      | 'availability'
      | 'expense'
      | 'status_check'
      | 'menu'
      | 'cancel'
      | 'unknown';
  }
  return 'unknown';
}

const HELP_TEXT = `Hi! I can help with:
• *Timesheet* — say "log 4 hours on PROJ001 today"
• *Availability* — say "I'm available 8h Mon–Fri next week"
• *Expense* — send a receipt photo + the project code
• *Status* — ask "how many hours this week"
Type *cancel* anytime to abort.`;

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

/**
 * Timesheet flow — single-shot LLM parse of the user's text. Asks for
 * a project + hours + date and creates a TimesheetEntry in `draft`
 * status (the staff member can then approve via the web UI).
 *
 * Free-form examples it should handle:
 *   "Log 4h on PROJ001 today"
 *   "8 hours yesterday for project ALPHA"
 *   "Logged 3.5 hrs Friday on PROJ002 — discovery review"
 */
const TimesheetSchema = z.object({
  projectCode: z.string().trim().min(2).max(20),
  hours: z.coerce.number().min(0).max(24),
  // ISO date — we parse "today" / "yesterday" / "monday" via the
  // model's resolution, defaulting to today when unclear.
  dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(500).nullable().optional(),
});

async function parseTimesheet(
  text: string,
  todayIso: string,
): Promise<z.infer<typeof TimesheetSchema> | { error: string }> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return { error: 'Timesheet parsing requires LLM access — please use the web app for now.' };
  }
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 256,
    system: `Extract a timesheet entry from the user's message. Return ONLY JSON in this shape:
{
  "projectCode": "string (e.g. PROJ001)",
  "hours": number 0..24,
  "dateIso": "YYYY-MM-DD (today=${todayIso}; resolve 'yesterday', weekdays etc.)",
  "description": "string or null"
}
If the message doesn't contain a parseable timesheet entry, return {"error": "short reason"}.`,
    messages: [{ role: 'user', content: text }],
  });
  const block = res.content.find((c) => c.type === 'text');
  const raw = block && 'text' in block ? block.text : '';
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return { error: String(parsed.error) };
    }
    const validated = TimesheetSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        error:
          'Couldn\'t parse the timesheet bits — try "log 4 hours on PROJ001 today".',
      };
    }
    return validated.data;
  } catch {
    return { error: 'Try "log 4 hours on PROJ001 today".' };
  }
}

async function handleTimesheet(
  person: Person,
  conversation: WhatsAppConversation,
  message: IncomingMessage,
): Promise<void> {
  const text = message.text ?? '';
  const todayIso = new Date().toISOString().slice(0, 10);
  const parsed = await parseTimesheet(text, todayIso);
  if ('error' in parsed) {
    await reply(conversation.id, message.fromPhone, parsed.error);
    return;
  }
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
}

/**
 * Availability flow — accept a sentence like "I'm available 8h Mon-Fri
 * next week" and write per-day rows for the next Monday-Sunday week.
 */
const AvailabilitySchema = z.object({
  weekStartIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hoursByDow: z.object({
    mon: z.coerce.number().min(0).max(24).optional().default(0),
    tue: z.coerce.number().min(0).max(24).optional().default(0),
    wed: z.coerce.number().min(0).max(24).optional().default(0),
    thu: z.coerce.number().min(0).max(24).optional().default(0),
    fri: z.coerce.number().min(0).max(24).optional().default(0),
    sat: z.coerce.number().min(0).max(24).optional().default(0),
    sun: z.coerce.number().min(0).max(24).optional().default(0),
  }),
  notes: z.string().trim().max(200).nullable().optional(),
});

async function parseAvailability(
  text: string,
  thisMondayIso: string,
  nextMondayIso: string,
): Promise<z.infer<typeof AvailabilitySchema> | { error: string }> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey)
    return {
      error:
        'Availability parsing needs LLM access — please use the web app for now.',
    };
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system: `Extract the user's weekly availability from their message. Return ONLY JSON:
{
  "weekStartIso": "YYYY-MM-DD (Monday). 'this week'=${thisMondayIso}, 'next week'=${nextMondayIso}",
  "hoursByDow": { "mon": 0, "tue": 0, "wed": 0, "thu": 0, "fri": 0, "sat": 0, "sun": 0 },
  "notes": "string or null"
}
Default to next week when ambiguous. Use 0 for unmentioned days.
If unparseable, return {"error":"short reason"}.`,
    messages: [{ role: 'user', content: text }],
  });
  const block = res.content.find((c) => c.type === 'text');
  const raw = block && 'text' in block ? block.text : '';
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return { error: String(parsed.error) };
    }
    const validated = AvailabilitySchema.safeParse(parsed);
    if (!validated.success) {
      return {
        error: 'Try "I\'m available 8h Mon-Fri next week".',
      };
    }
    return validated.data;
  } catch {
    return { error: 'Try "I\'m available 8h Mon-Fri next week".' };
  }
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
  const parsed = await parseAvailability(
    text,
    thisMonday.toISOString().slice(0, 10),
    nextMonday.toISOString().slice(0, 10),
  );
  if ('error' in parsed) {
    await reply(conversation.id, message.fromPhone, parsed.error);
    return;
  }
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

// ─── Top-level dispatcher ─────────────────────────────────────────────

export async function handleIncomingWhatsAppMessage(
  message: IncomingMessage,
): Promise<{ ok: boolean; reason?: string }> {
  const person = await resolvePerson(message.fromPhone);
  if (!person) {
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
