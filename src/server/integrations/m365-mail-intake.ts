import { prisma } from '@/server/db';
import { graph, graphConfigured, GraphError } from '@/server/graph';
import { optionalEnv } from '@/server/env';
import { writeAudit } from '@/server/audit';
import { resolveRequiredRole } from '@/server/approval-policies';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import {
  extractIntakeFields,
  type IntakeExtraction,
} from '@/server/agents/intake-ocr/extract';

/**
 * AP autoharvest — TASK-093.
 *
 * Polls the two intake mailboxes (finance@ canonical, trung@ transitional
 * — see INTEGRATIONS.md §7) via Microsoft Graph app-token every 15 min
 * from /api/cron/invoice-autoharvest. Filters aggressively with the
 * looksLikeInvoice heuristic before spending OCR tokens, extracts fields
 * via the shared claude-sonnet helper (extractIntakeFields), matches
 * supplier by ABN then name, dedups by (supplier + invoiceNumber), lands
 * a Bill row as pending_review with an Approval + AuditEvent.
 *
 * Pattern mirrors src/server/integrations/uber-email-intake.ts — same
 * cron-driven, per-item try/catch, heartbeat-audit-per-fire shape. The
 * differences vs Uber:
 *   - Source is Graph mail directly (not a SharePoint folder populated by
 *     Power Automate) — Mail.Read is granted at app-level, scoped by
 *     Exchange ApplicationAccessPolicy to these two mailboxes only.
 *   - Output is Bill (AP, pending_review), not Expense (AR reimbursable).
 *   - Watermark is Graph receivedDateTime persisted in MailboxPollCursor.
 *
 * BillStatus has no `awaiting_human` value — low-confidence extractions
 * land as pending_review like everything else; confidence is captured in
 * the audit-event delta and the admin card's 24h counter. See
 * ~/.claude/.../memory/foundry_bill_status_enum.md for the rationale.
 */

// Cursor doesn't reach back further than this on the very first fire —
// avoids churning through years of mail if the cursor row is fresh.
// After the first fire, lastReceivedDateTime carries the true watermark.
const FIRST_RUN_LOOKBACK_HOURS = 24;

// Graph message-list page size. Kept modest so a single fire fits inside
// the cron's 180s maxDuration budget even when every message needs OCR.
const MESSAGES_PER_PAGE = 50;

// Hard cap per mailbox per fire — a defensive bound so a stuck mailbox
// (e.g. cursor lost, huge backlog) can't blow the Vercel timeout. The
// remainder gets picked up on the next fire.
const MAX_MESSAGES_PER_FIRE = 100;

// Subject regex for the heuristic. Anchored on common invoice/receipt/
// reminder language across suppliers. Deliberately loose per the spec's
// "lean false-positive-tolerant" guidance — better to OCR a few extras.
const INVOICE_SUBJECT_REGEX =
  /invoice|bill(?:ing)?|statement|receipt|payable|payment|due|remittance/i;

// M365 categories set by the user in Outlook that mark a message as
// personal / do-not-process. Matched case-insensitively.
const PERSONAL_CATEGORIES = new Set([
  'personal',
  'private',
  'family',
  'do not process',
]);

// ─── Graph shapes ────────────────────────────────────────────────────

export type GraphEmailAddress = {
  address: string;
  name?: string;
};

export type GraphMessage = {
  id: string;
  subject: string | null;
  from: { emailAddress: GraphEmailAddress } | null;
  receivedDateTime: string; // ISO-8601
  hasAttachments: boolean;
  categories: string[];
  webLink?: string;
  bodyPreview?: string;
  attachments?: GraphAttachment[];
};

export type GraphAttachment = {
  id: string;
  name: string;
  contentType: string;
  size?: number;
  isInline?: boolean;
  '@odata.type'?: string;
  contentBytes?: string; // fileAttachment inlines base64-encoded content
};

// ─── Heuristic (exported for tests) ─────────────────────────────────

export type HeuristicResult = { ok: true } | { ok: false; reason: string };

/**
 * Cheap filter that decides whether a Graph message is worth spending
 * OCR tokens on. Deliberately permissive — see spec's "lean false-
 * positive-tolerant" guidance.
 *
 * Rules:
 *  1. Must have at least one attachment.
 *  2. At least one attachment mime-type is application/pdf or image/*.
 *  3. Subject matches INVOICE_SUBJECT_REGEX.
 *  4. Not tagged with a personal M365 category.
 *
 * Sender domain is intentionally NOT filtered — internal forwards from
 * staff (e.g. Chris dragging a vendor invoice into finance@) come from
 * an @foundry.health address and should still be processed. Random
 * personal mail that happens to match the subject regex + attachment
 * types falls through to OCR → lands as pending_review with no Supplier
 * match → admin rejects from /approvals. Volume is low; the cost is
 * bounded.
 */
export function looksLikeInvoice(msg: GraphMessage): HeuristicResult {
  if (!msg.hasAttachments) return { ok: false, reason: 'no attachments' };

  const attachments = msg.attachments ?? [];
  const hasFileAttachment = attachments.some(
    (a) =>
      a.contentType === 'application/pdf' ||
      (typeof a.contentType === 'string' && a.contentType.startsWith('image/')),
  );
  if (!hasFileAttachment) {
    return { ok: false, reason: 'no PDF/image attachment' };
  }

  const subject = msg.subject ?? '';
  if (!INVOICE_SUBJECT_REGEX.test(subject)) {
    return { ok: false, reason: 'subject regex mismatch' };
  }

  const categories = (msg.categories ?? []).map((c) => c.toLowerCase());
  if (categories.some((c) => PERSONAL_CATEGORIES.has(c))) {
    return { ok: false, reason: 'personal M365 category' };
  }

  return { ok: true };
}

// ─── Public API — stats for admin page ──────────────────────────────

export type MailIntakeStatsPerMailbox = {
  mailboxUpn: string;
  enabled: boolean;
  lastPollAt: Date | null;
  lastError: string | null;
  lastReceivedDateTime: Date | null;
  toggledByPersonName: string | null;
  billsCreated24h: number;
  candidatesScanned24h: number;
  lowConfidenceCount24h: number;
  failedExtracts24h: number;
  recentFailures: Array<{
    at: Date;
    messageId: string;
    subject: string | null;
    fromAddress: string | null;
    reason: string;
  }>;
};

export type MailIntakeStats = {
  configured: boolean;
  perMailbox: MailIntakeStatsPerMailbox[];
};

const LOW_CONFIDENCE_THRESHOLD = 70;

export async function getMailIntakeStats(): Promise<MailIntakeStats> {
  const configured = graphConfigured();

  const cursors = await prisma.mailboxPollCursor.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      actor: {
        select: { firstName: true, lastName: true },
      },
    },
  });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const perMailbox: MailIntakeStatsPerMailbox[] = [];
  for (const cursor of cursors) {
    const events = await prisma.auditEvent.findMany({
      where: {
        entityType: 'integration',
        entityId: 'm365_mail',
        at: { gte: since },
      },
      orderBy: { at: 'desc' },
      take: 500,
      select: { at: true, action: true, entityDelta: true },
    });

    let billsCreated = 0;
    let candidatesScanned = 0;
    let lowConfidence = 0;
    let failed = 0;
    const recentFailures: MailIntakeStatsPerMailbox['recentFailures'] = [];

    for (const ev of events) {
      const delta = ev.entityDelta as {
        created?: Record<string, unknown>;
        after?: Record<string, unknown>;
      } | null;
      const after = delta?.after ?? delta?.created;
      if (!after) continue;
      if (after['mailboxUpn'] !== cursor.mailboxUpn) continue;

      if (ev.action === 'synced') {
        candidatesScanned += Number(after['candidatesScanned'] ?? 0);
        billsCreated += Number(after['billsCreated'] ?? 0);
        lowConfidence += Number(after['lowConfidenceCount'] ?? 0);
      } else if (ev.action === 'extract_failed') {
        failed += 1;
        if (recentFailures.length < 20) {
          recentFailures.push({
            at: ev.at,
            messageId: String(after['messageId'] ?? ''),
            subject: (after['subject'] as string) ?? null,
            fromAddress: (after['fromAddress'] as string) ?? null,
            reason: String(after['reason'] ?? 'unknown'),
          });
        }
      }
    }

    const toggledByPersonName = cursor.actor
      ? `${cursor.actor.firstName} ${cursor.actor.lastName}`.trim()
      : null;

    perMailbox.push({
      mailboxUpn: cursor.mailboxUpn,
      enabled: cursor.enabled,
      lastPollAt: cursor.lastPollAt,
      lastError: cursor.lastError,
      lastReceivedDateTime: cursor.lastReceivedDateTime,
      toggledByPersonName,
      billsCreated24h: billsCreated,
      candidatesScanned24h: candidatesScanned,
      lowConfidenceCount24h: lowConfidence,
      failedExtracts24h: failed,
      recentFailures,
    });
  }

  return { configured, perMailbox };
}

// ─── Public API — poller ────────────────────────────────────────────

export type MailboxPollResult = {
  ok: true;
  mailboxUpn: string;
  messagesConsidered: number;
  candidatesScanned: number;
  billsCreated: number;
  billsSkippedDuplicate: number;
  extractionsFailed: number;
  lowConfidenceCount: number;
  advanceCursorTo: Date | null;
  errors: string[];
  /** Present when the mailbox was skipped without polling — cron not
   *  configured, feature-flag off, mailbox disabled, etc. */
  skippedReason?: string;
};

/**
 * Poll every enabled MailboxPollCursor row. Iterates rather than fans out
 * — Graph rate limits are per-tenant, and two sequential mailboxes fit
 * comfortably in the 180s cron budget.
 */
export async function pollAllMailboxes(opts: {
  actorPersonId: string;
}): Promise<{ mailboxes: MailboxPollResult[] }> {
  const cursors = await prisma.mailboxPollCursor.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  });

  const results: MailboxPollResult[] = [];
  for (const cursor of cursors) {
    const res = await pollMailbox({
      mailboxUpn: cursor.mailboxUpn,
      actorPersonId: opts.actorPersonId,
    });
    results.push(res);
  }

  return { mailboxes: results };
}

/**
 * Poll one mailbox. Never throws — errors are surfaced via `errors` +
 * `lastError` on the cursor row so the cron loop keeps moving through
 * the other mailboxes.
 */
export async function pollMailbox(opts: {
  mailboxUpn: string;
  actorPersonId: string;
}): Promise<MailboxPollResult> {
  const { mailboxUpn, actorPersonId } = opts;
  const empty: MailboxPollResult = {
    ok: true,
    mailboxUpn,
    messagesConsidered: 0,
    candidatesScanned: 0,
    billsCreated: 0,
    billsSkippedDuplicate: 0,
    extractionsFailed: 0,
    lowConfidenceCount: 0,
    advanceCursorTo: null,
    errors: [],
  };

  if (!graphConfigured()) {
    return { ...empty, skippedReason: 'graph not configured' };
  }
  if (optionalEnv('DISABLE_MAIL_INTAKE') === '1') {
    return { ...empty, skippedReason: 'DISABLE_MAIL_INTAKE=1' };
  }

  const cursor = await prisma.mailboxPollCursor.findUnique({
    where: { mailboxUpn },
  });
  if (!cursor) {
    return { ...empty, skippedReason: 'no cursor row (seed needed)' };
  }
  if (!cursor.enabled) {
    return { ...empty, skippedReason: 'cursor disabled' };
  }

  const startWatermark =
    cursor.lastReceivedDateTime ??
    new Date(Date.now() - FIRST_RUN_LOOKBACK_HOURS * 60 * 60 * 1000);

  let messages: GraphMessage[];
  try {
    messages = await listMessagesSince(mailboxUpn, startWatermark);
  } catch (err) {
    const reason = err instanceof GraphError
      ? `Graph ${err.status}: ${JSON.stringify(err.body).slice(0, 200)}`
      : (err as Error).message;
    await prisma.mailboxPollCursor.update({
      where: { mailboxUpn },
      data: { lastPollAt: new Date(), lastError: reason },
    });
    return { ...empty, errors: [reason] };
  }

  const result: MailboxPollResult = { ...empty, messagesConsidered: messages.length };
  let newestReceivedDateTime = startWatermark;

  for (const msg of messages) {
    const msgReceivedAt = new Date(msg.receivedDateTime);
    if (msgReceivedAt > newestReceivedDateTime) newestReceivedDateTime = msgReceivedAt;

    const heuristic = looksLikeInvoice(msg);
    if (!heuristic.ok) continue;
    result.candidatesScanned += 1;

    try {
      const outcome = await processMessage({
        message: msg,
        mailboxUpn,
        actorPersonId,
      });
      if (outcome.kind === 'created') {
        result.billsCreated += 1;
        if (outcome.lowConfidence) result.lowConfidenceCount += 1;
      } else if (outcome.kind === 'duplicate') {
        result.billsSkippedDuplicate += 1;
      } else if (outcome.kind === 'extract_failed') {
        result.extractionsFailed += 1;
        await writeExtractFailureAudit({
          actorPersonId,
          mailboxUpn,
          message: msg,
          reason: outcome.reason,
        });
      }
    } catch (err) {
      const reason = (err as Error).message;
      result.errors.push(`${msg.id}: ${reason}`);
      result.extractionsFailed += 1;
      await writeExtractFailureAudit({
        actorPersonId,
        mailboxUpn,
        message: msg,
        reason,
      });
    }
  }

  // Advance the cursor only if we made it through the loop without a
  // fatal Graph error (per-message failures are OK — the loop continued).
  // The watermark advances to the newest message we saw, not just the
  // last one processed, so a rejected message doesn't re-appear next fire.
  result.advanceCursorTo = newestReceivedDateTime;
  await prisma.mailboxPollCursor.update({
    where: { mailboxUpn },
    data: {
      lastPollAt: new Date(),
      lastReceivedDateTime: newestReceivedDateTime,
      lastError: null,
    },
  });

  return result;
}

// ─── Graph mail-list helper ─────────────────────────────────────────

async function listMessagesSince(
  mailboxUpn: string,
  since: Date,
): Promise<GraphMessage[]> {
  const isoSince = since.toISOString();
  // $select on messages narrows the payload; $expand=attachments($select)
  // pulls attachment metadata + contentBytes (for fileAttachment) in one
  // hop so per-message download loops don't re-fetch the same data.
  //
  // NOTE: $expand=attachments won't include $value binaries for large
  // referenceAttachment types — for those we fall back to a per-attachment
  // /$value fetch inside processMessage.
  const filter = `receivedDateTime gt ${isoSince}`;
  const orderBy = 'receivedDateTime asc';
  const select = [
    'id',
    'subject',
    'from',
    'receivedDateTime',
    'hasAttachments',
    'categories',
    'webLink',
    'bodyPreview',
  ].join(',');
  const expand = 'attachments($select=id,name,contentType,size,isInline,contentBytes)';

  const out: GraphMessage[] = [];
  let url: string | null =
    `/users/${encodeURIComponent(mailboxUpn)}/messages` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$orderby=${encodeURIComponent(orderBy)}` +
    `&$select=${select}` +
    `&$expand=${expand}` +
    `&$top=${MESSAGES_PER_PAGE}`;

  while (url && out.length < MAX_MESSAGES_PER_FIRE) {
    const page: {
      value: GraphMessage[];
      '@odata.nextLink'?: string;
    } = await graph('GET', url);
    out.push(...page.value);
    url = page['@odata.nextLink'] ?? null;
  }

  return out.slice(0, MAX_MESSAGES_PER_FIRE);
}

// ─── Per-message processing ─────────────────────────────────────────

type ProcessOutcome =
  | { kind: 'created'; billId: string; lowConfidence: boolean }
  | { kind: 'duplicate'; reason: string }
  | { kind: 'extract_failed'; reason: string };

async function processMessage(args: {
  message: GraphMessage;
  mailboxUpn: string;
  actorPersonId: string;
}): Promise<ProcessOutcome> {
  const { message, mailboxUpn, actorPersonId } = args;

  const candidateAttachments = (message.attachments ?? []).filter(
    (a) =>
      !a.isInline &&
      (a.contentType === 'application/pdf' ||
        (typeof a.contentType === 'string' && a.contentType.startsWith('image/'))),
  );

  if (candidateAttachments.length === 0) {
    return { kind: 'extract_failed', reason: 'no processable attachment' };
  }

  type Extracted = {
    attachment: GraphAttachment;
    extraction: IntakeExtraction;
  };
  const extracted: Extracted[] = [];
  const failures: string[] = [];

  for (const att of candidateAttachments) {
    const base64 = att.contentBytes
      ? att.contentBytes
      : await downloadAttachmentBase64(mailboxUpn, message.id, att.id);
    if (!base64) {
      failures.push(`${att.name}: no content`);
      continue;
    }
    const res = await extractIntakeFields({
      base64,
      mimeType: att.contentType,
      fileName: att.name,
    });
    if (res.ok) {
      extracted.push({ attachment: att, extraction: res.data });
    } else {
      failures.push(`${att.name}: ${res.reason}`);
    }
  }

  if (extracted.length === 0) {
    return {
      kind: 'extract_failed',
      reason: failures.length ? failures.join(' · ') : 'no extraction succeeded',
    };
  }

  // Pick the highest-confidence extraction across all attachments —
  // discards logos / footers automatically.
  extracted.sort(
    (a, b) => b.extraction.confidence.overall - a.extraction.confidence.overall,
  );
  const best = extracted[0]!;

  // Supplier match: ABN first, then normalised name.
  const supplier = await resolveSupplier(best.extraction);

  // Dedupe by (supplier key + invoice number).
  const supplierKey = supplier?.id ?? best.extraction.supplierName ?? '';
  const invoiceNumber = best.extraction.invoiceNumber ?? '';
  if (supplierKey && invoiceNumber) {
    const existing = await prisma.bill.findFirst({
      where: {
        supplierInvoiceNumber: invoiceNumber,
        OR: [
          supplier?.id ? { supplierId: supplier.id } : { supplierName: best.extraction.supplierName ?? undefined },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      return {
        kind: 'duplicate',
        reason: `duplicate of Bill ${existing.id}`,
      };
    }
  }

  // Build Bill fields — money is integer cents.
  const amountCents = best.extraction.amountTotalDollars
    ? Math.round(best.extraction.amountTotalDollars * 100)
    : 0;
  if (amountCents <= 0) {
    return {
      kind: 'extract_failed',
      reason: `no usable amount in ${best.attachment.name}`,
    };
  }
  const gstCents = best.extraction.gstDollars
    ? Math.round(best.extraction.gstDollars * 100)
    : 0;

  const issueDate = best.extraction.issueDate
    ? new Date(`${best.extraction.issueDate}T00:00:00Z`)
    : new Date(message.receivedDateTime);
  // Due date defaults to 30 days from issue when the invoice omits it —
  // matches the /bills/intake manual flow's fallback.
  const dueDate = best.extraction.dueDate
    ? new Date(`${best.extraction.dueDate}T00:00:00Z`)
    : new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  const category = best.extraction.category ?? 'other';
  const requiredRole = await resolveRequiredRole('bill', amountCents);
  const overallConfidence = best.extraction.confidence.overall;
  const lowConfidence = overallConfidence < LOW_CONFIDENCE_THRESHOLD;

  const billId = await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.create({
      data: {
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? best.extraction.supplierName ?? 'Unknown vendor',
        supplierInvoiceNumber: best.extraction.invoiceNumber ?? null,
        receivedVia: 'email',
        originalEmailId: message.id,
        attachmentSharepointUrl: null,
        issueDate,
        dueDate,
        amountTotal: amountCents,
        gst: gstCents,
        category,
        status: 'pending_review',
      },
    });
    const approval = await tx.approval.create({
      data: {
        subjectType: 'bill',
        subjectId: bill.id,
        requestedById: actorPersonId,
        requiredRole,
        thresholdContext: {
          amount_cents: amountCents,
          source: 'm365_mail_intake',
          mailbox_upn: mailboxUpn,
          message_id: message.id,
          confidence: overallConfidence,
        },
        channel: 'web',
      },
      select: { id: true },
    });
    await notifyApproversOfNewApproval(tx, {
      approvalId: approval.id,
      subjectType: 'bill',
      subjectId: bill.id,
      requiredRole,
      requestedById: actorPersonId,
      amountCents,
      summary: `${supplier?.name ?? best.extraction.supplierName ?? 'Unknown'} · $${(amountCents / 100).toFixed(0)} · ${message.subject ?? '(no subject)'}`,
    });
    await writeAudit(tx, {
      actor: { type: 'person', id: actorPersonId },
      action: 'created',
      entity: {
        type: 'bill',
        id: bill.id,
        after: {
          via: 'm365_mail_intake',
          mailboxUpn,
          messageId: message.id,
          messageSubject: message.subject,
          fromAddress: message.from?.emailAddress?.address ?? null,
          attachmentName: best.attachment.name,
          amount_cents: amountCents,
          gst_cents: gstCents,
          supplier_id: supplier?.id ?? null,
          supplier_name: supplier?.name ?? best.extraction.supplierName ?? null,
          supplier_invoice_number: best.extraction.invoiceNumber ?? null,
          confidence: overallConfidence,
          low_confidence: lowConfidence,
        },
      },
      source: 'integration_sync',
    });
    return bill.id;
  });

  // Heartbeat audit — one row per successful message so the stats
  // helper can count `billsCreated24h` per mailbox. Separate from the
  // per-bill audit above (which is the row admins actually inspect).
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: { type: 'person', id: actorPersonId },
      action: 'synced',
      entity: {
        type: 'integration',
        id: 'm365_mail',
        after: {
          mailboxUpn,
          messageId: message.id,
          billsCreated: 1,
          candidatesScanned: 1,
          lowConfidenceCount: lowConfidence ? 1 : 0,
        },
      },
      source: 'integration_sync',
    });
  });

  return { kind: 'created', billId, lowConfidence };
}

// ─── Supplier matching ──────────────────────────────────────────────

async function resolveSupplier(
  extraction: IntakeExtraction,
): Promise<{ id: string; name: string } | null> {
  const abn = extraction.supplierAbn?.replace(/\s+/g, '') ?? null;
  if (abn && /^\d{11}$/u.test(abn)) {
    const byAbn = await prisma.supplier.findFirst({
      where: { abn },
      select: { id: true, name: true },
    });
    if (byAbn) return byAbn;
  }

  const rawName = extraction.supplierName?.trim();
  if (!rawName) return null;

  // Case-insensitive equality first (Supplier.name is unique).
  const byName = await prisma.supplier.findFirst({
    where: { name: { equals: rawName, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (byName) return byName;

  return null;
}

// ─── Graph attachment download ──────────────────────────────────────

async function downloadAttachmentBase64(
  mailboxUpn: string,
  messageId: string,
  attachmentId: string,
): Promise<string | null> {
  try {
    // /$value returns raw bytes; wrapper reads it here and base64-encodes
    // for the Anthropic vision helper. Only used for attachments too big
    // for the initial $expand to inline (referenceAttachment or >~4MB
    // fileAttachment). fileAttachments already inline contentBytes.
    const path = `/users/${encodeURIComponent(mailboxUpn)}/messages/${messageId}/attachments/${attachmentId}/$value`;
    const att = await graph<{ contentBytes?: string }>('GET', path);
    return att.contentBytes ?? null;
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

// ─── Failure audit helper ───────────────────────────────────────────

async function writeExtractFailureAudit(args: {
  actorPersonId: string;
  mailboxUpn: string;
  message: GraphMessage;
  reason: string;
}): Promise<void> {
  const { actorPersonId, mailboxUpn, message, reason } = args;
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: { type: 'person', id: actorPersonId },
      action: 'extract_failed',
      entity: {
        type: 'integration',
        id: 'm365_mail',
        after: {
          mailboxUpn,
          messageId: message.id,
          subject: message.subject,
          fromAddress: message.from?.emailAddress?.address ?? null,
          reason,
        },
      },
      source: 'integration_sync',
    });
  });
}
