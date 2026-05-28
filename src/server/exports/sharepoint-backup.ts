import { graph, graphConfigured, getAppToken, GraphError } from '@/server/graph';
import { optionalEnv } from '@/server/env';

/**
 * Upload the business-continuity export ZIP to a secure folder
 * under the SharePoint admin tree. Per A3 (SharePoint/OneDrive for
 * all files), the binary lives in M365 with the org's existing
 * access controls; our DB just records the URL.
 *
 * Folder layout (resolved at runtime — see `resolveBackupsRoot`):
 *
 *   <SHAREPOINT_BACKUPS_ROOT>/<YYYY-MM-DD>/<filename>.zip
 *
 * The backups root resolves in this priority order:
 *   1. `SHAREPOINT_BACKUPS_ROOT` env var (preferred — dedicated
 *      folder, kept separate from per-project admin paperwork).
 *      Recommended default for Foundry:
 *      `CORPORATE/ADMIN ACCESS/00 Administration/05 System Backups`
 *   2. Fallback: `<SHAREPOINT_ADMIN_ROOT>/00 Backups` — nests
 *      under the existing admin root, with `00 Backups` sorting
 *      to the top of the alphabetical view.
 *
 * **Access**: the SharePoint folder permissions are set on the
 * SharePoint side (admin-only group). This module doesn't manage
 * ACLs — it just writes to the path the admin has already locked
 * down. Per the security checklist in CLAUDE.md, the folder should
 * be restricted to super_admin / admin via the M365 group sync.
 *
 * Returns the webUrl that gets recorded in the audit row. Returns
 * null when Graph isn't configured (dev / Entra outage); the
 * caller logs a warning and skips the upload.
 */

export type BackupUploadResult = {
  webUrl: string;
  folderPath: string;
  filename: string;
};

/**
 * Resolve the SharePoint folder path the data-export bundles land
 * in. Exposed so the admin page can display the same path the
 * uploader will actually write to (no drift between docs + runtime).
 */
export function resolveBackupsRoot(): string | null {
  const explicit = optionalEnv('SHAREPOINT_BACKUPS_ROOT');
  if (explicit) return explicit;
  const admin = optionalEnv('SHAREPOINT_ADMIN_ROOT');
  if (admin) return `${admin}/00 Backups`;
  return null;
}

export async function uploadDataExportToSharePoint(opts: {
  buffer: Buffer;
  filename: string;
}): Promise<BackupUploadResult | null> {
  if (!graphConfigured()) return null;
  const siteUrl = optionalEnv('SHAREPOINT_SITE_URL');
  if (!siteUrl) return null;
  const backupsRoot = resolveBackupsRoot();
  if (!backupsRoot) {
    throw new Error(
      'SharePoint backups root not configured — set SHAREPOINT_BACKUPS_ROOT (or SHAREPOINT_ADMIN_ROOT as fallback) to the admin-only folder where data exports should land.',
    );
  }

  const siteId = await resolveSiteId(siteUrl);
  const driveId = await resolveDriveId(siteId);

  // Build the folder path: <backupsRoot>/<date>. The previous
  // layout had an extra `data-exports/` segment but the dedicated
  // backups root now IS the data-exports folder — no need to nest.
  const today = new Date().toISOString().slice(0, 10);
  const segments = [
    ...backupsRoot.split('/').map((s) => s.trim()).filter(Boolean),
    today,
  ];
  let parentPath = '';
  for (const seg of segments) {
    await ensureFolder(driveId, parentPath, seg);
    parentPath = parentPath ? `${parentPath}/${seg}` : seg;
  }

  // Upload the ZIP. Under 4MB → simple PUT to the upload path.
  // Above 4MB → chunked upload session. The export bundles are
  // typically under 1MB at Foundry scale, so we use the simple
  // path first and fall back to a chunked session if a future
  // export ever balloons.
  const filename = opts.filename.replace(/[/\\?%*:|"<>]/g, '-');
  const filePath = `${parentPath}/${filename}`;
  if (opts.buffer.length < 4 * 1024 * 1024) {
    const item = await uploadSmallFile(driveId, filePath, opts.buffer);
    return { webUrl: item.webUrl, folderPath: parentPath, filename };
  } else {
    const item = await uploadLargeFile(driveId, filePath, opts.buffer);
    return { webUrl: item.webUrl, folderPath: parentPath, filename };
  }
}

type DriveItem = { id: string; webUrl: string; name: string };

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

/**
 * Direct content upload via PUT for files < 4MB. Larger exports
 * go through `uploadLargeFile` which uses a chunked upload session.
 *
 * `graphRaw` is bypassed here because it auto-sets the
 * `application/json` content-type when a body is present — we need
 * `application/zip`. Call fetch directly with the right headers.
 */
async function uploadSmallFile(
  driveId: string,
  filePath: string,
  buffer: Buffer,
): Promise<DriveItem> {
  const token = await getAppToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodePath(filePath)}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/zip',
    },
    // Hand the buffer to fetch — Node's undici accepts Buffer as
    // a body. Cast to BodyInit so TS doesn't grump.
    body: buffer as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GraphError(res.status, text);
  }
  return (await res.json()) as DriveItem;
}

/**
 * Chunked upload session for files >= 4MB. Not exercised at
 * Foundry's current scale but defensive — a year-of-history export
 * could plausibly cross the threshold.
 */
async function uploadLargeFile(
  driveId: string,
  filePath: string,
  buffer: Buffer,
): Promise<DriveItem> {
  const session = await graph<{ uploadUrl: string }>(
    'POST',
    `/drives/${driveId}/root:/${encodePath(filePath)}:/createUploadSession`,
    {
      item: {
        '@microsoft.graph.conflictBehavior': 'replace',
        name: filePath.split('/').pop(),
      },
    },
  );
  const chunkSize = 5 * 1024 * 1024; // 5MB chunks
  let offset = 0;
  let lastResponse: DriveItem | null = null;
  while (offset < buffer.length) {
    const end = Math.min(offset + chunkSize, buffer.length);
    const slice = buffer.slice(offset, end);
    const res = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(slice.length),
        'Content-Range': `bytes ${offset}-${end - 1}/${buffer.length}`,
      },
      body: slice as unknown as BodyInit,
    });
    if (res.status === 202 || res.status === 201 || res.status === 200) {
      // The final chunk's response contains the DriveItem.
      if (end === buffer.length) {
        lastResponse = (await res.json()) as DriveItem;
      }
    } else {
      const text = await res.text();
      throw new GraphError(res.status, text);
    }
    offset = end;
  }
  if (!lastResponse) {
    throw new Error('Upload completed but no DriveItem returned');
  }
  return lastResponse;
}

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

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}
