import * as XLSX from 'xlsx';
import {
  graph,
  graphConfigured,
  getAppToken,
  GraphError,
} from '@/server/graph';
import { optionalEnv } from '@/server/env';
import { resolveSiteAndDrive } from '@/server/integrations/sharepoint-graph';

/**
 * Excel export infrastructure (TASK-060).
 *
 * Two concerns, kept separate so the pure builder is unit-testable
 * without Graph:
 *
 *   1. `buildWorkbookBuffer(sheets)` — assemble an .xlsx byte buffer
 *      from plain sheet definitions (header row + data rows). No I/O.
 *   2. `uploadWorkbookToSharePoint({ workbookName, buffer })` — publish
 *      the workbook to the SharePoint Reports folder, overwriting the
 *      previous copy atomically (upload to a temp name, then rename over
 *      the published name so a reader never sees a half-written file).
 *
 * Per A3 the app stores only the pointer; the binary lives in M365 with
 * the org's own access controls. Graph permission required:
 * `Files.ReadWrite.All` (Application) — same scope the receipts +
 * backup uploaders already use, no new Entra grant.
 *
 * Library: SheetJS (`xlsx`) — already a dependency (used on the import
 * side); "ExcelJS or equivalent" per the task. No proprietary template.
 */

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Graph docs: <4MB is a direct PUT; larger needs an upload session.
const CHUNKED_UPLOAD_THRESHOLD = 4 * 1024 * 1024;

// Excel forbids these in a sheet/tab name, and caps the name at 31 chars.
const SHEET_NAME_INVALID = /[\\/?*[\]:]/gu;
// SharePoint forbids these in a filename.
const FILENAME_INVALID = /[/\\?%*:|"<>]/gu;

// ─── Types ──────────────────────────────────────────────────────────

export type WorkbookCell = string | number | boolean | null;

export type WorkbookSheet = {
  /** Tab name — sanitised + truncated to 31 chars, deduped per workbook. */
  name: string;
  /** Row 1 column headers. */
  header: string[];
  /** Data rows, aligned to `header`. */
  rows: WorkbookCell[][];
};

export type WorkbookUploadResult = {
  webUrl: string;
  folderPath: string;
  filename: string;
};

// ─── Pure builder ───────────────────────────────────────────────────

/**
 * Excel sheet names must be ≤31 chars and exclude `\ / ? * [ ] :`.
 * Empty falls back to "Sheet". Exported for tests.
 */
export function sanitiseSheetName(name: string): string {
  const cleaned = name.replace(SHEET_NAME_INVALID, '-').trim();
  return (cleaned || 'Sheet').slice(0, 31);
}

/**
 * Column widths (in characters) derived from the widest cell in each
 * column, clamped to [8, 60] so long free-text doesn't blow the layout.
 */
function computeColWidths(
  header: string[],
  rows: WorkbookCell[][],
): { wch: number }[] {
  const widths = header.map((h) => String(h ?? '').length);
  for (const row of rows) {
    row.forEach((cell, i) => {
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      if (len > (widths[i] ?? 0)) widths[i] = len;
    });
  }
  return widths.map((w) => ({ wch: Math.min(60, Math.max(8, w + 1)) }));
}

/**
 * Build an .xlsx buffer from one or more sheet definitions. Numeric
 * cells stay numeric (so Excel can sum them); strings stay text.
 */
export function buildWorkbookBuffer(sheets: WorkbookSheet[]): Buffer {
  if (sheets.length === 0) {
    throw new Error('buildWorkbookBuffer: at least one sheet is required');
  }
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sheet of sheets) {
    const aoa: WorkbookCell[][] = [sheet.header, ...sheet.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = computeColWidths(sheet.header, sheet.rows);

    // Guarantee a unique tab name within the workbook.
    const base = sanitiseSheetName(sheet.name);
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` (${n++})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// ─── SharePoint publish ─────────────────────────────────────────────

/**
 * Resolve the SharePoint folder .xlsx reports are published to.
 *   1. `SHAREPOINT_REPORTS_ROOT` (preferred — dedicated folder).
 *   2. `<SHAREPOINT_ADMIN_ROOT>/04 Reports`.
 *   3. Default under the Financial admin tree.
 * Exported so an admin surface can show the same path the uploader uses.
 */
export function resolveReportsRoot(): string {
  const explicit = optionalEnv('SHAREPOINT_REPORTS_ROOT');
  if (explicit) return explicit;
  const admin = optionalEnv('SHAREPOINT_ADMIN_ROOT');
  if (admin) return `${admin}/04 Reports`;
  return 'CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/04 Reports';
}

/**
 * Publish a workbook to `<ReportsRoot>/<workbookName>.xlsx`, overwriting
 * the previous copy atomically. Returns null when Graph isn't configured
 * so callers can degrade to a no-op (and audit the skip).
 */
export async function uploadWorkbookToSharePoint(opts: {
  workbookName: string; // without extension
  buffer: Buffer;
}): Promise<WorkbookUploadResult | null> {
  if (!graphConfigured()) return null;
  const siteUrl = optionalEnv('SHAREPOINT_SITE_URL');
  if (!siteUrl) return null;

  const { driveId } = await resolveSiteAndDrive(siteUrl);

  const root = resolveReportsRoot();
  await ensureFolderTree(driveId, root);

  const safeName = opts.workbookName.replace(FILENAME_INVALID, '-');
  const filename = `${safeName}.xlsx`;
  const finalPath = `${root}/${filename}`;
  // Leading dot + timestamp keeps the in-progress file out of the way
  // and collision-free if two runs overlap.
  const tmpPath = `${root}/.${safeName}.xlsx.tmp-${Date.now()}`;

  // 1. Upload the full workbook to the temp path.
  const tmpItem = await uploadBytes(driveId, tmpPath, opts.buffer);

  // 2. Swap into place: drop any existing published copy, then rename
  //    the temp item onto the published name. The published file is
  //    never mid-write — readers see the old copy until the rename,
  //    then the new one.
  await deleteIfExists(driveId, finalPath);
  const published = await renameItem(driveId, tmpItem.id, filename);

  return { webUrl: published.webUrl, folderPath: root, filename };
}

// ─── Graph primitives ───────────────────────────────────────────────
// Copies of the primitives in sharepoint-backup.ts / sharepoint-receipts.ts.
// A follow-up (TASK-042c) should extract these into a shared
// `sharepoint-graph.ts`; kept in-file here to avoid a cross-module dep
// mid-feature.

type DriveItem = { id: string; webUrl: string; name: string };

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

async function uploadBytes(
  driveId: string,
  filePath: string,
  buffer: Buffer,
): Promise<DriveItem> {
  if (buffer.length < CHUNKED_UPLOAD_THRESHOLD) {
    const token = await getAppToken();
    const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodePath(filePath)}:/content`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': XLSX_MIME },
      body: buffer as unknown as BodyInit,
    });
    if (!res.ok) throw new GraphError(res.status, await res.text());
    return (await res.json()) as DriveItem;
  }
  const session = await graph<{ uploadUrl: string }>(
    'POST',
    `/drives/${driveId}/root:/${encodePath(filePath)}:/createUploadSession`,
    { item: { '@microsoft.graph.conflictBehavior': 'replace' } },
  );
  const chunkSize = 5 * 1024 * 1024;
  let offset = 0;
  let last: DriveItem | null = null;
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
    if (res.status === 200 || res.status === 201 || res.status === 202) {
      if (end === buffer.length) last = (await res.json()) as DriveItem;
    } else {
      throw new GraphError(res.status, await res.text());
    }
    offset = end;
  }
  if (!last) throw new Error('Upload completed but no DriveItem returned');
  return last;
}

async function deleteIfExists(driveId: string, filePath: string): Promise<void> {
  try {
    await graph('DELETE', `/drives/${driveId}/root:/${encodePath(filePath)}`);
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return; // nothing to replace
    throw err;
  }
}

async function renameItem(
  driveId: string,
  itemId: string,
  newName: string,
): Promise<DriveItem> {
  return await graph<DriveItem>('PATCH', `/drives/${driveId}/items/${itemId}`, {
    name: newName,
  });
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}
