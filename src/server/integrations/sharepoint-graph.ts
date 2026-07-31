import { graph } from '@/server/graph';

/**
 * Shared SharePoint site/drive resolution with a short per-process cache
 * (TASK-069f). Resolving a site URL to its `siteId` + default-drive
 * `driveId` is two Graph round-trips, and the nightly backup does ~9
 * uploads that each used to re-resolve — ~16 redundant calls a night.
 * The IDs are effectively immutable, so we memoise per site URL with a
 * short TTL (a cold start or TTL lapse re-resolves, so a rare site move
 * still heals).
 *
 * This is the first step of the standing TASK-042c cleanup — extracting
 * the site/drive primitives duplicated across `sharepoint-backup.ts`,
 * `excel-workbook.ts`, and `sharepoint-receipts.ts` into one place.
 */

export type SiteDrive = { siteId: string; driveId: string };

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map<string, { value: SiteDrive; at: number }>();

export async function resolveSiteAndDrive(siteUrl: string): Promise<SiteDrive> {
  const now = Date.now();
  const hit = cache.get(siteUrl);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  const parsed = new URL(siteUrl);
  const path = parsed.pathname.replace(/\/+$/u, '');
  const site = await graph<{ id: string }>(
    'GET',
    `/sites/${parsed.hostname}:${path}`,
  );
  const drive = await graph<{ id: string }>('GET', `/sites/${site.id}/drive`);
  const value: SiteDrive = { siteId: site.id, driveId: drive.id };
  cache.set(siteUrl, { value, at: now });
  return value;
}

/** Test/maintenance hook — drop the memoised resolutions. */
export function clearSiteDriveCache(): void {
  cache.clear();
}
