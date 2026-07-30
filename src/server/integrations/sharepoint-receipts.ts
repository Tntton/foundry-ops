import {
  graph,
  graphConfigured,
  getAppToken,
  GraphError,
} from '@/server/graph';
import { optionalEnv } from '@/server/env';

/**
 * SharePoint receipts / attachments uploader (TASK-042b + TASK-046b).
 *
 * Every submitted expense or bill that carries a physical receipt lands
 * a copy of the file in the corporate SharePoint archive for audit +
 * ATO record-keeping. Layout:
 *
 *   <RECEIPTS_ROOT>/FY YY - YY+1/{Expenses|Bills}/YYYY-MM/<filename>
 *
 * Root defaults to the folder TT called out on 2026-05-30:
 *   `CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/
 *    01 Company Administration/FY 26 - 27`
 *
 * — but SHAREPOINT_RECEIPTS_ROOT can override the parent above the FY
 * segment so the same code survives an org restructure.
 *
 * Design notes:
 *   - FY subfolder is auto-derived from the receipt date. AU FY starts
 *     July 1 (see `deriveAustralianFY`), so a July-2026 receipt lands
 *     in `FY 26 - 27/` and stays there forever — never renamed.
 *   - Filename is `YYYY-MM-DD - <vendor> - $<amount> - <initials> - <shortId>.<ext>`
 *     so an accountant scrolling the folder can identify a row without
 *     opening it, and search-by-date/vendor works in the SharePoint UI.
 *   - Returns both `webUrl` (for direct clicks / audit trail) AND
 *     `driveItemId` (for the proxied inline preview at
 *     /api/attachments/*, which needs Graph binary streaming).
 *   - Doesn't dedupe on filename — collisions (same date, same vendor,
 *     same amount) fall through to a `-1`, `-2` suffix via SharePoint's
 *     conflictBehavior=rename. Prevents silent overwrites.
 *
 * Graph permission required: `Files.ReadWrite.All` (Application) — same
 * scope the SharePoint backup + Uber email-intake already use. No new
 * Entra grant needed beyond what's live.
 */

const DEFAULT_RECEIPTS_ROOT =
  'CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/01 Company Administration';

// SharePoint disallows these in filenames — replace with `-`.
const FILENAME_INVALID_CHARS = /[/\\?%*:|"<>#]/gu;

// Chunked upload threshold — Graph docs say <4MB is fine as a direct
// PUT; larger goes through createUploadSession. Receipts are usually
// well under 1MB, but travel invoices with embedded scans can reach
// 6-8MB, so we branch defensively.
const CHUNKED_UPLOAD_THRESHOLD = 4 * 1024 * 1024;

// ─── FY derivation ──────────────────────────────────────────────────

/**
 * Convert a Date into an Australian financial-year folder segment,
 * e.g. `FY 26 - 27` for any date between 1 Jul 2026 and 30 Jun 2027
 * inclusive.
 *
 * Exported for tests.
 */
export function deriveAustralianFY(date: Date): string {
  const year = date.getUTCFullYear() % 100;
  const month = date.getUTCMonth(); // 0-indexed: Jan=0, Jul=6
  const [startYY, endYY] =
    month >= 6
      ? [year, (year + 1) % 100]
      : [(year + 99) % 100, year];
  return `FY ${pad2(startYY)} - ${pad2(endYY)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ─── Filename derivation ────────────────────────────────────────────

/**
 * Build the canonical receipt filename.
 *
 *   `2026-07-08 - Amazon Web Services - $89 - TT - exp_ab12cd.pdf`
 *
 * Vendor is truncated/sanitised so path length stays under the 400-char
 * SharePoint URL limit even for very long amounts + IDs. Empty vendor
 * falls back to "no-vendor" so the shape is stable.
 */
export function buildReceiptFilename(input: {
  date: Date;
  vendor: string | null | undefined;
  amountCents: number;
  ownerInitials: string;
  id: string;
  extension: string;
}): string {
  const iso = input.date.toISOString().slice(0, 10);
  const vendor = (input.vendor ?? 'no-vendor')
    .replace(FILENAME_INVALID_CHARS, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 60);
  const dollars = Math.round(input.amountCents / 100);
  const shortId = input.id.slice(-8);
  const ext = input.extension.replace(/^\.+/u, '').toLowerCase() || 'bin';
  return `${iso} - ${vendor} - $${dollars} - ${input.ownerInitials} - ${shortId}.${ext}`;
}

/**
 * Extension inference from mimeType, with a `.bin` fallback so the file
 * still lands in SharePoint even if we don't recognise the type.
 */
export function extensionFromMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    default:
      return 'bin';
  }
}

// ─── Folder path derivation ─────────────────────────────────────────

/**
 * Absolute drive-relative path (no leading slash) for a given receipt.
 * Exported for tests + logging.
 */
export function receiptFolderPath(kind: 'expense' | 'bill', date: Date): string {
  const root =
    optionalEnv('SHAREPOINT_RECEIPTS_ROOT') ?? DEFAULT_RECEIPTS_ROOT;
  const fy = deriveAustralianFY(date);
  const yyyyMM = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
  const bucket = kind === 'expense' ? 'Expenses' : 'Bills';
  return `${root}/${fy}/${bucket}/${yyyyMM}`;
}

// ─── Public API ─────────────────────────────────────────────────────

export type ReceiptUploadResult = {
  webUrl: string;
  driveItemId: string;
  folderPath: string;
  filename: string;
};

export type ReceiptUploadInput = {
  kind: 'expense' | 'bill';
  date: Date;
  vendor: string | null | undefined;
  amountCents: number;
  ownerInitials: string;
  id: string;
  buffer: Buffer;
  mimeType: string;
  originalFilename?: string | null;
};

/**
 * Upload a receipt / attachment to the corporate SharePoint archive.
 * Returns null when Graph or SharePoint isn't configured so callers
 * can gracefully degrade to a DB-only record with no attachment URL.
 * All other errors throw — the caller (usually a server action) catches
 * and surfaces a UI-friendly message.
 */
export async function uploadReceiptToSharePoint(
  input: ReceiptUploadInput,
): Promise<ReceiptUploadResult | null> {
  if (!graphConfigured()) return null;
  const siteUrl = optionalEnv('SHAREPOINT_SITE_URL');
  if (!siteUrl) return null;

  const siteId = await resolveSiteId(siteUrl);
  const driveId = await resolveDriveId(siteId);

  const folderPath = receiptFolderPath(input.kind, input.date);
  await ensureFolderTree(driveId, folderPath);

  const ext = extensionFromMime(input.mimeType);
  const filename = buildReceiptFilename({
    date: input.date,
    vendor: input.vendor,
    amountCents: input.amountCents,
    ownerInitials: input.ownerInitials,
    id: input.id,
    extension: ext,
  });
  const filePath = `${folderPath}/${filename}`;

  const item =
    input.buffer.length < CHUNKED_UPLOAD_THRESHOLD
      ? await uploadSmallFile(driveId, filePath, input.buffer, input.mimeType)
      : await uploadLargeFile(driveId, filePath, input.buffer, filename);

  return {
    webUrl: item.webUrl,
    driveItemId: item.id,
    folderPath,
    filename: item.name,
  };
}

// ─── Invoice PDF archival (TASK-068) ────────────────────────────────
//
// Finalised tax-invoice PDFs land in the same corporate archive as
// receipts, under a sibling `Invoices` bucket so an accountant sees
// AR PDFs alongside the AP receipts they were rebilled from:
//
//   <RECEIPTS_ROOT>/FY YY - YY+1/Invoices/YYYY-MM/<filename>
//
// FY is derived from the invoice issue date (same AU-FY rule as
// receipts). Targeting the per-project admin/financial folder
// (`Project.sharepointAdminFolderUrl`) is a future refinement — it
// needs a webUrl→drive-path resolver we don't have yet — so for now
// every finalised invoice files into this one date-partitioned tree,
// which is itself audit-complete.

/**
 * Drive-relative folder path (no leading slash) for a finalised invoice
 * PDF, partitioned by the invoice issue date. Exported for tests.
 */
export function invoiceFolderPath(issueDate: Date): string {
  const root =
    optionalEnv('SHAREPOINT_RECEIPTS_ROOT') ?? DEFAULT_RECEIPTS_ROOT;
  const fy = deriveAustralianFY(issueDate);
  const yyyyMM = `${issueDate.getUTCFullYear()}-${pad2(issueDate.getUTCMonth() + 1)}`;
  return `${root}/${fy}/Invoices/${yyyyMM}`;
}

/**
 * Canonical filename for an archived tax-invoice PDF, e.g.
 *   `2026-07-08 - IFM001-INV-12 - $18700 - TT - a1b2c3d4.pdf`
 * so the invoice number, total and issuer are legible in the SharePoint
 * folder without opening the file. Exported for tests.
 */
export function buildInvoiceFilename(input: {
  issueDate: Date;
  invoiceNumber: string;
  amountTotalCents: number;
  ownerInitials: string;
  id: string;
}): string {
  const iso = input.issueDate.toISOString().slice(0, 10);
  const num = (input.invoiceNumber || 'no-number')
    .replace(FILENAME_INVALID_CHARS, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 60);
  const dollars = Math.round(input.amountTotalCents / 100);
  const shortId = input.id.slice(-8);
  return `${iso} - ${num} - $${dollars} - ${input.ownerInitials} - ${shortId}.pdf`;
}

export type InvoiceUploadResult = {
  webUrl: string;
  driveItemId: string;
  folderPath: string;
  filename: string;
};

export type InvoiceUploadInput = {
  issueDate: Date;
  invoiceNumber: string;
  amountTotalCents: number;
  ownerInitials: string;
  id: string;
  buffer: Buffer;
};

/**
 * Upload a finalised tax-invoice PDF to the corporate SharePoint
 * archive. Returns null when Graph or SharePoint isn't configured so
 * the finalise action can gracefully degrade to a DB-only record with
 * no pointer (and retry on the next finalise). All other errors throw.
 */
export async function uploadInvoicePdfToSharePoint(
  input: InvoiceUploadInput,
): Promise<InvoiceUploadResult | null> {
  if (!graphConfigured()) return null;
  const siteUrl = optionalEnv('SHAREPOINT_SITE_URL');
  if (!siteUrl) return null;

  const siteId = await resolveSiteId(siteUrl);
  const driveId = await resolveDriveId(siteId);

  const folderPath = invoiceFolderPath(input.issueDate);
  await ensureFolderTree(driveId, folderPath);

  const filename = buildInvoiceFilename({
    issueDate: input.issueDate,
    invoiceNumber: input.invoiceNumber,
    amountTotalCents: input.amountTotalCents,
    ownerInitials: input.ownerInitials,
    id: input.id,
  });
  const filePath = `${folderPath}/${filename}`;

  const item =
    input.buffer.length < CHUNKED_UPLOAD_THRESHOLD
      ? await uploadSmallFile(driveId, filePath, input.buffer, 'application/pdf')
      : await uploadLargeFile(driveId, filePath, input.buffer, filename);

  return {
    webUrl: item.webUrl,
    driveItemId: item.id,
    folderPath,
    filename: item.name,
  };
}

// ─── Graph primitives ───────────────────────────────────────────────
//
// Copies of the primitives in `src/server/exports/sharepoint-backup.ts`
// (kept in-file for now — small footprint, avoids a cross-module dep in
// the middle of this feature). A follow-up refactor should extract them
// into `sharepoint-graph.ts` shared by backup / uber-email-intake / this
// module; see TASK-042c.

type DriveItem = { id: string; webUrl: string; name: string };

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

async function ensureFolderTree(driveId: string, path: string): Promise<void> {
  const segments = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  let parentPath = '';
  for (const seg of segments) {
    await ensureFolder(driveId, parentPath, seg);
    parentPath = parentPath ? `${parentPath}/${seg}` : seg;
  }
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

async function uploadSmallFile(
  driveId: string,
  filePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<DriveItem> {
  const token = await getAppToken();
  // ?@microsoft.graph.conflictBehavior=rename guarantees a `-1`/`-2`
  // suffix on collision, protecting against silent overwrites when
  // (date + vendor + amount + person + shortId) happen to match.
  const url =
    `https://graph.microsoft.com/v1.0/drives/${driveId}` +
    `/root:/${encodePath(filePath)}:/content` +
    `?@microsoft.graph.conflictBehavior=rename`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: buffer as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GraphError(res.status, text);
  }
  return (await res.json()) as DriveItem;
}

async function uploadLargeFile(
  driveId: string,
  filePath: string,
  buffer: Buffer,
  filename: string,
): Promise<DriveItem> {
  const session = await graph<{ uploadUrl: string }>(
    'POST',
    `/drives/${driveId}/root:/${encodePath(filePath)}:/createUploadSession`,
    {
      item: {
        '@microsoft.graph.conflictBehavior': 'rename',
        name: filename,
      },
    },
  );
  const chunkSize = 5 * 1024 * 1024;
  let offset = 0;
  let lastResponse: DriveItem | null = null;
  while (offset < buffer.length) {
    const end = Math.min(offset + chunkSize, buffer.length);
    const slice = buffer.subarray(offset, end);
    const res = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(slice.length),
        'Content-Range': `bytes ${offset}-${end - 1}/${buffer.length}`,
      },
      body: slice as unknown as BodyInit,
    });
    if (res.status === 202 || res.status === 201 || res.status === 200) {
      if (end === buffer.length) {
        lastResponse = (await res.json()) as DriveItem;
      }
    } else {
      const text = await res.text();
      throw new GraphError(res.status, text);
    }
    offset = end;
  }
  if (!lastResponse) throw new Error('Upload completed but no DriveItem returned');
  return lastResponse;
}

/**
 * Stream a DriveItem's raw bytes back to the caller. Used by the
 * proxied inline-preview route /api/attachments/[kind]/[id] so
 * approvers see receipts without leaving Foundry Ops.
 */
export async function downloadDriveItem(driveItemId: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  if (!graphConfigured()) {
    throw new Error('Graph not configured');
  }
  const siteUrl = optionalEnv('SHAREPOINT_SITE_URL');
  if (!siteUrl) throw new Error('SHAREPOINT_SITE_URL not set');
  const siteId = await resolveSiteId(siteUrl);
  const driveId = await resolveDriveId(siteId);

  const token = await getAppToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${driveItemId}/content`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GraphError(res.status, text);
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), contentType };
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}
