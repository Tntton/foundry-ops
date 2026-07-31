import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TASK-069f · cached site/drive resolver. Proves a repeat resolution of
 * the same site URL is served from cache (no extra Graph calls) — the
 * whole point of cutting the nightly backup's redundant round-trips.
 */

const graph = vi.hoisted(() => vi.fn());
vi.mock('@/server/graph', () => ({ graph }));

import {
  resolveSiteAndDrive,
  clearSiteDriveCache,
} from '@/server/integrations/sharepoint-graph';

beforeEach(() => {
  vi.clearAllMocks();
  clearSiteDriveCache();
  // Two calls per cold resolution: /sites/{host}:{path} then /sites/{id}/drive.
  graph
    .mockResolvedValueOnce({ id: 'site-1' })
    .mockResolvedValueOnce({ id: 'drive-1' })
    .mockResolvedValue({ id: 'unexpected' });
});

describe('resolveSiteAndDrive', () => {
  it('resolves site + drive with two Graph calls', async () => {
    const res = await resolveSiteAndDrive('https://foundry.sharepoint.com/sites/Foundry');
    expect(res).toEqual({ siteId: 'site-1', driveId: 'drive-1' });
    expect(graph).toHaveBeenCalledTimes(2);
  });

  it('serves a repeat resolution from cache (no extra Graph calls)', async () => {
    const url = 'https://foundry.sharepoint.com/sites/Foundry';
    await resolveSiteAndDrive(url);
    await resolveSiteAndDrive(url);
    await resolveSiteAndDrive(url);
    // Still just the initial two calls — the 2nd + 3rd were cached.
    expect(graph).toHaveBeenCalledTimes(2);
  });

  it('re-resolves after the cache is cleared', async () => {
    const url = 'https://foundry.sharepoint.com/sites/Foundry';
    await resolveSiteAndDrive(url);
    clearSiteDriveCache();
    graph.mockResolvedValueOnce({ id: 'site-2' }).mockResolvedValueOnce({ id: 'drive-2' });
    await resolveSiteAndDrive(url);
    expect(graph).toHaveBeenCalledTimes(4);
  });
});
