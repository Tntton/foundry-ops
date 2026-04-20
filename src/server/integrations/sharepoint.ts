import { graph, GraphError, graphConfigured } from '@/server/graph';
import { optionalEnv } from '@/server/env';

type DriveItem = { id: string; webUrl: string; name: string };

/**
 * Provision the SharePoint folder tree for a project. Safe to call repeatedly —
 * existing folders are reused; missing ones are created.
 *
 * Structure:
 *   /<SHAREPOINT_CLIENTS_ROOT>/<ClientCode>/<ProjectCode>/01 Brief
 *                                                        /02 Working
 *                                                        /03 Delivery
 *                                                        /04 Admin
 *
 * Returns the webUrl of the project folder on success, or null when Graph /
 * SharePoint env isn't configured yet (feature-flag off).
 */
export async function provisionProjectFolder(
  clientCode: string,
  projectCode: string,
): Promise<string | null> {
  if (!graphConfigured()) return null;
  const siteUrl = optionalEnv('SHAREPOINT_SITE_URL');
  if (!siteUrl) return null;

  const siteId = await resolveSiteId(siteUrl);
  const driveId = await resolveDriveId(siteId);
  const rootName = optionalEnv('SHAREPOINT_CLIENTS_ROOT') ?? 'Clients';

  await createFolder(driveId, '', rootName);
  await createFolder(driveId, rootName, clientCode);
  const projectFolder = await createFolder(
    driveId,
    `${rootName}/${clientCode}`,
    projectCode,
  );
  for (const sub of ['01 Brief', '02 Working', '03 Delivery', '04 Admin']) {
    await createFolder(driveId, `${rootName}/${clientCode}/${projectCode}`, sub);
  }

  return projectFolder.webUrl;
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

async function createFolder(
  driveId: string,
  parentPath: string, // empty string for drive root
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
      // Already exists — fetch it.
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
