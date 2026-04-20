import { graph, GraphError, graphConfigured } from '@/server/graph';
import { optionalEnv } from '@/server/env';

type DriveItem = { id: string; webUrl: string; name: string };

/**
 * Provision the SharePoint folder trees for a project — TWO trees:
 *
 * 1. **Team (project work)** under SHAREPOINT_CLIENTS_ROOT:
 *      <root>/<ClientCode> <ClientName>/<ProjectCode>/{01 Brief, 02 Working, 03 Delivery, 04 Admin}
 *    Default root matches Foundry's existing structure:
 *      CORPORATE/TEAM ACCESS/01 Client projects/01 Active clients
 *
 * 2. **Admin (financial)** under SHAREPOINT_ADMIN_ROOT:
 *      <admin-root>/<ClientCode> <ClientName>/<ProjectCode>
 *    For invoices / receipts / payment docs. Default root:
 *      CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/02 Project administration
 *
 * Safe to call repeatedly — existing folders reused via 409 fallback.
 * Returns { teamUrl, adminUrl } or null if Graph not configured.
 */
export type ProvisionResult = {
  teamUrl: string;
  adminUrl: string | null;
};

export async function provisionProjectFolder(
  clientCode: string,
  clientName: string,
  projectCode: string,
): Promise<ProvisionResult | null> {
  if (!graphConfigured()) return null;
  const siteUrl = optionalEnv('SHAREPOINT_SITE_URL');
  if (!siteUrl) return null;

  const siteId = await resolveSiteId(siteUrl);
  const driveId = await resolveDriveId(siteId);

  const clientFolderName = `${clientCode} ${clientName}`.trim();

  // Team/project work — root + subfolders both env-configurable.
  const teamUrl = await ensureProjectTree(
    driveId,
    optionalEnv('SHAREPOINT_CLIENTS_ROOT') ??
      'CORPORATE/TEAM ACCESS/01 Client projects/01 Active clients',
    clientFolderName,
    projectCode,
    parseSubfolders(optionalEnv('SHAREPOINT_TEAM_SUBFOLDERS'), [
      '01 Brief',
      '02 Working',
      '03 Delivery',
      '04 Admin',
    ]),
  );

  // Admin/financial — only if admin root is configured.
  let adminUrl: string | null = null;
  const adminRoot = optionalEnv('SHAREPOINT_ADMIN_ROOT');
  if (adminRoot) {
    adminUrl = await ensureProjectTree(
      driveId,
      adminRoot,
      clientFolderName,
      projectCode,
      parseSubfolders(optionalEnv('SHAREPOINT_ADMIN_SUBFOLDERS'), []),
    );
  }

  return { teamUrl, adminUrl };
}

function parseSubfolders(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ensureProjectTree(
  driveId: string,
  rootPathSpec: string,
  clientFolderName: string,
  projectCode: string,
  subfolders: string[],
): Promise<string> {
  // Walk the root path segment by segment
  const rootSegments = rootPathSpec
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  let rootPath = '';
  for (const seg of rootSegments) {
    await createFolder(driveId, rootPath, seg);
    rootPath = rootPath ? `${rootPath}/${seg}` : seg;
  }

  await createFolder(driveId, rootPath, clientFolderName);
  const projectFolder = await createFolder(
    driveId,
    `${rootPath}/${clientFolderName}`,
    projectCode,
  );
  for (const sub of subfolders) {
    await createFolder(driveId, `${rootPath}/${clientFolderName}/${projectCode}`, sub);
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
