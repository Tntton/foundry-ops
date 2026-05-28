import { prisma } from '@/server/db';
import { graph, graphRaw, getAppToken, graphConfigured, GraphError } from '@/server/graph';
import { optionalEnv } from '@/server/env';
import { writeAudit } from '@/server/audit';
import { resolveRequiredRole } from '@/server/approval-policies';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import { resolveTravellerByEmail } from '@/server/integrations/navan-sync';
import { mapFreeFormToCategory } from '@/lib/expense-categories';
import {
  extractIntakeFields,
  type IntakeExtraction,
} from '@/server/agents/intake-ocr/extract';

/**
 * Uber receipt email-intake. Pairs with a Microsoft Power Automate
 * flow (configured per INTEGRATIONS.md §6) that watches an inbox for
 * `noreply@uber.com` ride-receipt emails and drops the PDF attachment
 * into a SharePoint folder. This module is the Foundry-side puller:
 * a cron route lists the inbox, OCRs each PDF, lands an Expense row
 * attributed to the rider, and moves the file to the processed tree.
 *
 * Why Expense (not Bill, unlike the CSV / SFTP paths):
 *   - The email-receipt arrives because the ride was paid on a
 *     *personal* card (Uber emails the rider). The corporate-AMEX
 *     channel for Uber for Business still flows in as Bills via the
 *     existing CSV / SFTP feeds.
 *   - Expense is reimbursable to the rider → personId carries the
 *     rider's Person.id, status=submitted, an Approval row attaches.
 *
 * Rider-match strategy (mirrors `resolveTravellerByEmail`):
 *   1. Filename prefix `<email>__rest.pdf` — Power Automate sets the
 *      filename to `<dynamicTo>__<originalName>.pdf` so the rider
 *      email survives the SharePoint hop without re-reading the
 *      message. Documented in the Power Automate recipe.
 *   2. Fallback: ask the OCR agent for the rider email out of the
 *      PDF body (Uber receipts include "Hi <first> <last>" and the
 *      recipient email near the footer). One extra Sonnet call per
 *      receipt, only when the filename hint is missing.
 *   3. Both miss → file moves to a `_unmatched/` subtree with no
 *      Expense created; surfaced in the result + last-poll telemetry
 *      so admin can repair manually.
 */

const INBOX_PATH_DEFAULT =
  'CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/05 Uber Receipts/Inbox';
const PROCESSED_PATH_DEFAULT =
  'CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/05 Uber Receipts/Processed';

export type UberEmailIntakeStats = {
  configured: boolean;
  inboxPath: string;
  processedPath: string;
  lastPollAt: Date | null;
  lastResult: UberEmailIntakeResult | null;
  filesImported24h: number;
  filesUnmatched24h: number;
  filesFailed24h: number;
};

/**
 * Surface email-intake activity for the admin page. Reads from the
 * AuditEvent rows the cron writes on each fire — we don't need a
 * second `lastPollAt` column on the Integration row because the cron
 * always writes an audit row (even on no-op runs).
 */
export async function getUberEmailIntakeStats(): Promise<UberEmailIntakeStats> {
  const inboxPath = optionalEnv('SHAREPOINT_UBER_INBOX_PATH') ?? INBOX_PATH_DEFAULT;
  const processedPath =
    optionalEnv('SHAREPOINT_UBER_PROCESSED_PATH') ?? PROCESSED_PATH_DEFAULT;
  const configured = Boolean(graphConfigured() && optionalEnv('SHAREPOINT_SITE_URL'));

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const events = await prisma.auditEvent.findMany({
    where: {
      entityType: 'integration',
      entityId: 'uber',
      action: 'synced',
      at: { gte: since },
    },
    orderBy: { at: 'desc' },
    take: 200,
    select: { at: true, entityDelta: true },
  });

  let imported = 0;
  let unmatched = 0;
  let failed = 0;
  let lastResult: UberEmailIntakeResult | null = null;
  let lastPollAt: Date | null = null;
  for (const ev of events) {
    const delta = ev.entityDelta as { created?: Record<string, unknown> } | null;
    const after = delta?.created;
    if (!after || (after as { via?: unknown }).via !== 'uber_email_intake') continue;
    if (lastResult === null) {
      lastResult = after as unknown as UberEmailIntakeResult;
      lastPollAt = ev.at;
    }
    imported += Number(after['filesImported'] ?? 0);
    unmatched += Number(after['filesUnmatched'] ?? 0);
    failed += Number(after['filesFailed'] ?? 0);
  }

  return {
    configured,
    inboxPath,
    processedPath,
    lastPollAt,
    lastResult,
    filesImported24h: imported,
    filesUnmatched24h: unmatched,
    filesFailed24h: failed,
  };
}

export type UberEmailIntakeResult = {
  ok: true;
  filesDiscovered: number;
  filesImported: number;
  filesSkipped: number; // dedup hits (already-imported by trip id)
  filesUnmatched: number; // moved to _unmatched/
  filesFailed: number;
  unmatchedRiders: string[];
  failedFiles: string[];
  /** When the inbox / processed folder paths aren't configured we
   *  skip cleanly so the cron route doesn't 500 — surfaced as a
   *  `skipped` reason instead. */
  skippedReason?: string;
};

type DriveItem = {
  id: string;
  webUrl: string;
  name: string;
  file?: { mimeType?: string };
  folder?: object;
  size?: number;
};

export async function processInbox(opts: {
  actorPersonId: string;
}): Promise<UberEmailIntakeResult> {
  const empty: UberEmailIntakeResult = {
    ok: true,
    filesDiscovered: 0,
    filesImported: 0,
    filesSkipped: 0,
    filesUnmatched: 0,
    filesFailed: 0,
    unmatchedRiders: [],
    failedFiles: [],
  };

  if (!graphConfigured()) {
    return { ...empty, skippedReason: 'graph not configured' };
  }
  const siteUrl = optionalEnv('SHAREPOINT_SITE_URL');
  if (!siteUrl) {
    return { ...empty, skippedReason: 'SHAREPOINT_SITE_URL not set' };
  }
  const inboxPath = optionalEnv('SHAREPOINT_UBER_INBOX_PATH') ?? INBOX_PATH_DEFAULT;
  const processedRoot =
    optionalEnv('SHAREPOINT_UBER_PROCESSED_PATH') ?? PROCESSED_PATH_DEFAULT;

  const siteId = await resolveSiteId(siteUrl);
  const driveId = await resolveDriveId(siteId);

  // List inbox children. The folder may not exist on first run if
  // Power Automate hasn't dropped anything yet — treat as empty.
  const inboxItem = await getItemByPathOrNull(driveId, inboxPath);
  if (!inboxItem) {
    return { ...empty, skippedReason: `inbox folder not found: ${inboxPath}` };
  }

  const children = await listAllChildren(driveId, inboxItem.id);
  const pdfs = children.filter(
    (c) =>
      !c.folder &&
      (c.file?.mimeType === 'application/pdf' ||
        c.name.toLowerCase().endsWith('.pdf')),
  );

  const result: UberEmailIntakeResult = { ...empty, filesDiscovered: pdfs.length };
  const unmatchedSet = new Set<string>();

  // Per-day processed folder — keeps the SharePoint tree navigable
  // even when daily volume grows. Created lazily on first hit.
  const today = new Date().toISOString().slice(0, 10);
  let processedDailyPath: string | null = null;
  let unmatchedPath: string | null = null;

  for (const pdf of pdfs) {
    try {
      const buffer = await downloadDriveItem(driveId, pdf.id);
      const outcome = await processOneReceipt({
        buffer,
        fileName: pdf.name,
        sharepointWebUrl: pdf.webUrl,
        actorPersonId: opts.actorPersonId,
      });

      if (outcome.kind === 'imported') {
        result.filesImported += 1;
        if (!processedDailyPath) {
          processedDailyPath = await ensureFolderTree(
            driveId,
            `${processedRoot}/${today}`,
          );
        }
        await moveItem(driveId, pdf.id, processedDailyPath, pdf.name);
      } else if (outcome.kind === 'skipped') {
        result.filesSkipped += 1;
        if (!processedDailyPath) {
          processedDailyPath = await ensureFolderTree(
            driveId,
            `${processedRoot}/${today}`,
          );
        }
        await moveItem(driveId, pdf.id, processedDailyPath, pdf.name);
      } else {
        // unmatched
        result.filesUnmatched += 1;
        if (outcome.email) unmatchedSet.add(outcome.email);
        if (!unmatchedPath) {
          unmatchedPath = await ensureFolderTree(
            driveId,
            `${processedRoot}/_unmatched`,
          );
        }
        await moveItem(driveId, pdf.id, unmatchedPath, pdf.name);
      }
    } catch (err) {
      console.error(`[uber-email-intake] ${pdf.name} failed:`, err);
      result.filesFailed += 1;
      result.failedFiles.push(pdf.name);
    }
  }

  result.unmatchedRiders = [...unmatchedSet];
  return result;
}

// ─── Per-receipt processing ─────────────────────────────────────────

type ProcessOutcome =
  | { kind: 'imported'; expenseId: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'unmatched'; email: string | null };

async function processOneReceipt(args: {
  buffer: Buffer;
  fileName: string;
  sharepointWebUrl: string;
  actorPersonId: string;
}): Promise<ProcessOutcome> {
  const { buffer, fileName, sharepointWebUrl, actorPersonId } = args;

  // 1. Resolve rider email — filename prefix first, then OCR fallback.
  const riderEmailFromFilename = parseRiderEmailFromFilename(fileName);
  const base64 = buffer.toString('base64');

  // 2. Run the standard receipt extraction. The OCR pipeline pulls
  //    supplier/amount/gst/date/category — we override category to
  //    `travel` after the fact since Uber is unambiguous.
  const extraction = await extractIntakeFields({
    base64,
    mimeType: 'application/pdf',
    fileName,
  });
  if (!extraction.ok) {
    // Treat extraction failure as a hard error — without the trip id
    // (invoiceNumber) we can't dedupe, and without amount we can't
    // create the Expense. The catch above marks it failed.
    throw new Error(`OCR failed for ${fileName}: ${extraction.reason}`);
  }

  // 3. Rider email: filename hint → else extract from PDF body.
  let riderEmail = riderEmailFromFilename;
  if (!riderEmail) {
    riderEmail = await extractRiderEmailFromPdf(base64, fileName);
  }
  if (!riderEmail) {
    return { kind: 'unmatched', email: null };
  }

  const rider = await resolveTravellerByEmail(riderEmail);
  if (!rider) {
    return { kind: 'unmatched', email: riderEmail };
  }

  // 4. Dedupe on the trip id / receipt number prefix. Match either an
  //    earlier email-intake landing OR an SFTP / CSV trip with the
  //    same id so we don't double-book a ride that arrived via both
  //    channels.
  const uberRef = extraction.data.invoiceNumber
    ? `uber:trip:${extraction.data.invoiceNumber}`
    : null;
  if (uberRef) {
    const dup = await prisma.expense.findFirst({
      where: { description: { startsWith: uberRef } },
      select: { id: true },
    });
    const dupBill = await prisma.bill.findFirst({
      where: { supplierInvoiceNumber: { startsWith: uberRef } },
      select: { id: true },
    });
    if (dup || dupBill) {
      return { kind: 'skipped', reason: `duplicate of ${uberRef}` };
    }
  }

  // 5. Build the Expense fields. Money is integer cents.
  const e: IntakeExtraction = extraction.data;
  const amountCents = e.amountTotalDollars
    ? Math.round(e.amountTotalDollars * 100)
    : 0;
  if (amountCents <= 0) {
    throw new Error(`No usable amount extracted for ${fileName}`);
  }
  const gstCents = e.gstDollars ? Math.round(e.gstDollars * 100) : 0;
  const issueDate = e.issueDate ? new Date(`${e.issueDate}T00:00:00Z`) : new Date();
  const category = mapFreeFormToCategory(e.category ?? 'travel');
  // Uber is always travel — override if the OCR drifted (e.g. "ground
  // transport" → mapped to other on a hiccup).
  const finalCategory = category === 'travel' ? category : 'travel';
  const descriptionParts = [
    uberRef ?? 'uber:trip:unknown',
    'Uber receipt (email)',
    e.notes,
  ].filter(Boolean) as string[];
  const description = descriptionParts.join(' · ').slice(0, 1000);

  const requiredRole = await resolveRequiredRole('expense', amountCents);

  const expenseId = await prisma.$transaction(async (tx) => {
    const row = await tx.expense.create({
      data: {
        personId: rider.id,
        projectId: null,
        date: issueDate,
        amount: amountCents,
        gst: gstCents,
        category: finalCategory,
        vendor: e.supplierName ?? 'Uber',
        description,
        receiptSharepointUrl: sharepointWebUrl,
        status: 'submitted',
      },
    });
    const approval = await tx.approval.create({
      data: {
        subjectType: 'expense',
        subjectId: row.id,
        requestedById: rider.id,
        requiredRole,
        thresholdContext: {
          amount_cents: amountCents,
          source: 'uber_email',
          uber_trip_id: e.invoiceNumber,
          rider_person_id: rider.id,
        },
        channel: 'web',
      },
      select: { id: true },
    });
    await notifyApproversOfNewApproval(tx, {
      approvalId: approval.id,
      subjectType: 'expense',
      subjectId: row.id,
      requiredRole,
      requestedById: rider.id,
      summary: `Uber · $${(amountCents / 100).toFixed(0)} · email receipt`,
    });
    await writeAudit(tx, {
      actor: { type: 'person', id: actorPersonId },
      action: 'created',
      entity: {
        type: 'expense',
        id: row.id,
        after: {
          via: 'uber_email',
          uber_trip_id: e.invoiceNumber,
          amount: amountCents,
          rider_person_id: rider.id,
          rider_email: riderEmail,
          file_name: fileName,
          confidence: e.confidence.overall,
        },
      },
      source: 'integration_sync',
    });
    return row.id;
  });

  return { kind: 'imported', expenseId };
}

/**
 * Filename convention from the Power Automate flow:
 *   `<rider-email>__<original-attachment-name>.pdf`
 * The double-underscore delimiter survives Uber's quirky default
 * filenames (`receipt-1f3a-…pdf`) without collision and is trivial
 * to parse without regex pathologies on edge inputs.
 *
 * Exported for the smoke test.
 */
export function parseRiderEmailFromFilename(fileName: string): string | null {
  const idx = fileName.indexOf('__');
  if (idx <= 0) return null;
  const candidate = fileName.slice(0, idx).trim().toLowerCase();
  // Loose email check — must contain a single @ and a dot in the
  // domain. Mismatch falls through to OCR.
  if (!candidate.includes('@')) return null;
  const at = candidate.indexOf('@');
  const domain = candidate.slice(at + 1);
  if (!domain.includes('.')) return null;
  return candidate;
}

/**
 * Ask Sonnet to pluck the rider's email out of an Uber receipt PDF.
 * Used as a fallback when the filename hint is missing — e.g. an
 * older Power Automate config or a manual drop into the inbox folder.
 * Returns null on any failure (caller treats as unmatched).
 */
async function extractRiderEmailFromPdf(
  base64: string,
  fileName: string,
): Promise<string | null> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return null;
  try {
    // Local import to avoid pulling the Anthropic SDK into the cron
    // bundle when extraction is disabled. The standard intake-ocr
    // module owns the SDK client config.
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 64,
      system:
        'Return only the rider\'s email address as plain text — no prose, no quotes. If absent, return "NONE".',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            {
              type: 'text',
              text: `What's the email address this Uber receipt was sent to? Filename: ${fileName}.`,
            },
          ],
        },
      ] as any,
    });
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return null;
    const raw = block.text.trim().toLowerCase();
    if (raw === 'none' || !raw.includes('@')) return null;
    // Strip wrapping punctuation the model sometimes adds.
    const cleaned = raw.replace(/^[<"'\s]+|[>"'\s.,]+$/g, '');
    if (!cleaned.includes('@')) return null;
    return cleaned;
  } catch (err) {
    console.warn('[uber-email-intake] rider-email OCR fallback failed:', err);
    return null;
  }
}

// ─── Graph / Drive helpers ──────────────────────────────────────────

async function resolveSiteId(siteUrl: string): Promise<string> {
  const parsed = new URL(siteUrl);
  const path = parsed.pathname.replace(/\/+$/u, '');
  const site = await graph<{ id: string }>(
    'GET',
    `/sites/${parsed.hostname}:${path}`,
  );
  return site.id;
}

async function resolveDriveId(siteId: string): Promise<string> {
  const drive = await graph<{ id: string }>('GET', `/sites/${siteId}/drive`);
  return drive.id;
}

async function getItemByPathOrNull(
  driveId: string,
  path: string,
): Promise<DriveItem | null> {
  try {
    return await graph<DriveItem>(
      'GET',
      `/drives/${driveId}/root:/${encodePath(path)}`,
    );
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

async function listAllChildren(
  driveId: string,
  folderId: string,
): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  let url: string | null = `/drives/${driveId}/items/${folderId}/children?$top=200`;
  while (url) {
    const page: { value: DriveItem[]; '@odata.nextLink'?: string } = await graph(
      'GET',
      url,
    );
    out.push(...page.value);
    url = page['@odata.nextLink'] ?? null;
  }
  return out;
}

/**
 * Download a DriveItem's binary content. Graph returns a 302 to a
 * short-lived storage URL on the `/content` endpoint — fetch() follows
 * redirects by default, which is what we want.
 */
async function downloadDriveItem(driveId: string, itemId: string): Promise<Buffer> {
  const token = await getAppToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GraphError(res.status, text);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Move a DriveItem into another folder, optionally renaming. Uses
 * PATCH with `parentReference` per Graph docs.
 */
async function moveItem(
  driveId: string,
  itemId: string,
  newParentPath: string,
  name: string,
): Promise<void> {
  const parent = await graph<DriveItem>(
    'GET',
    `/drives/${driveId}/root:/${encodePath(newParentPath)}`,
  );
  // Name collisions in the dated processed folder are highly unlikely
  // (Uber filenames carry a unique trip token) but if one hits, Graph
  // returns 409 — append the item id as a suffix and retry.
  try {
    await graph('PATCH', `/drives/${driveId}/items/${itemId}`, {
      parentReference: { id: parent.id },
      name,
    });
  } catch (err) {
    if (err instanceof GraphError && err.status === 409) {
      const dot = name.lastIndexOf('.');
      const renamed =
        dot > 0
          ? `${name.slice(0, dot)}-${itemId.slice(0, 6)}${name.slice(dot)}`
          : `${name}-${itemId.slice(0, 6)}`;
      await graph('PATCH', `/drives/${driveId}/items/${itemId}`, {
        parentReference: { id: parent.id },
        name: renamed,
      });
      return;
    }
    throw err;
  }
}

async function ensureFolderTree(driveId: string, path: string): Promise<string> {
  const segments = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  let cur = '';
  for (const seg of segments) {
    await ensureFolder(driveId, cur, seg);
    cur = cur ? `${cur}/${seg}` : seg;
  }
  return cur;
}

async function ensureFolder(
  driveId: string,
  parentPath: string,
  name: string,
): Promise<DriveItem> {
  const childrenPath = parentPath
    ? `/drives/${driveId}/root:/${encodePath(parentPath)}:/children`
    : `/drives/${driveId}/root/children`;
  try {
    return await graph<DriveItem>('POST', childrenPath, {
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    });
  } catch (err) {
    if (err instanceof GraphError && err.status === 409) {
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      return await graph<DriveItem>(
        'GET',
        `/drives/${driveId}/root:/${encodePath(fullPath)}`,
      );
    }
    throw err;
  }
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

// Re-export so tests can shim downstream calls without poking the
// SDK module directly. Currently unused; placeholder kept tidy.
void graphRaw;
