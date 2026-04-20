import { graph, graphRaw, GraphError, graphConfigured } from '@/server/graph';
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

  // Team/project work — two modes:
  //   1. SHAREPOINT_TEAM_TEMPLATE_PATH set → deep-copy that template folder
  //      and rename placeholder subfolders (e.g. "[PROJECT CODE]") to the
  //      real project code. This matches Foundry's "00 New client folder
  //      system / [COPY THIS TO EVERY NEW PROJECT]" convention.
  //   2. Otherwise → create the flat SHAREPOINT_TEAM_SUBFOLDERS list.
  const teamRoot =
    optionalEnv('SHAREPOINT_CLIENTS_ROOT') ??
    'CORPORATE/TEAM ACCESS/01 Client projects/01 Active clients';
  const templatePath = optionalEnv('SHAREPOINT_TEAM_TEMPLATE_PATH');
  let teamUrl: string;
  if (templatePath) {
    teamUrl = await copyTemplateTree(
      driveId,
      teamRoot,
      clientFolderName,
      projectCode,
      templatePath,
    );
  } else {
    teamUrl = await ensureProjectTree(
      driveId,
      teamRoot,
      clientFolderName,
      projectCode,
      parseSubfolders(optionalEnv('SHAREPOINT_TEAM_SUBFOLDERS'), [
        '01 Brief',
        '02 Working',
        '03 Delivery',
        '04 Admin',
      ]),
    );
  }

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

/**
 * Deep-copy a SharePoint template folder into a new project folder, then
 * rename any placeholder-named subfolders using the project code.
 *
 * Idempotent: if `<parent>/<projectCode>` already exists, returns its URL
 * without re-copying.
 *
 * Placeholder rule: any folder (at any depth) whose name contains
 * `[PROJECT CODE]` or `[PROJECTCODE]` gets renamed with the bracketed
 * token replaced by the real project code. TT's convention example:
 *   `00 [PROJECT CODE] Project administration`  →  `TST001 Project administration`
 */
async function copyTemplateTree(
  driveId: string,
  rootPathSpec: string,
  clientFolderName: string,
  projectCode: string,
  templatePath: string,
): Promise<string> {
  // Walk the root path + ensure client folder exists.
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
  const parentPath = `${rootPath}/${clientFolderName}`;

  // Idempotency: project folder already exists → return its URL, don't copy.
  const existing = await getItemByPathOrNull(driveId, `${parentPath}/${projectCode}`);
  if (existing) return existing.webUrl;

  // Resolve template + parent items (copy API needs IDs, not paths).
  const template = await graph<DriveItem>(
    'GET',
    `/drives/${driveId}/root:/${encodePath(templatePath)}`,
  );
  const parent = await graph<DriveItem>(
    'GET',
    `/drives/${driveId}/root:/${encodePath(parentPath)}`,
  );

  // Kick off async copy. Graph returns 202 Accepted with a Location header
  // pointing at a monitor URL — poll that until status=completed.
  const copyRes = await graphRaw(
    'POST',
    `/drives/${driveId}/items/${template.id}/copy`,
    { parentReference: { driveId, id: parent.id }, name: projectCode },
  );
  if (!copyRes.ok && copyRes.status !== 202) {
    const text = await copyRes.text();
    throw new GraphError(copyRes.status, text);
  }
  const monitor = copyRes.headers.get('location') ?? copyRes.headers.get('Location');
  if (!monitor) throw new Error('Graph copy did not return a monitor Location header');
  await waitForCopyCompletion(monitor);

  // Fetch the new project folder by path.
  const created = await graph<DriveItem>(
    'GET',
    `/drives/${driveId}/root:/${encodePath(`${parentPath}/${projectCode}`)}`,
  );

  // Walk the whole tree + substitute [PROJECT CODE] / [PROJECTCODE] placeholders.
  await substitutePlaceholdersRecursive(driveId, created.id, projectCode);

  return created.webUrl;
}

async function getItemByPathOrNull(
  driveId: string,
  path: string,
): Promise<DriveItem | null> {
  try {
    return await graph<DriveItem>('GET', `/drives/${driveId}/root:/${encodePath(path)}`);
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

async function waitForCopyCompletion(monitorUrl: string): Promise<void> {
  const timeoutAt = Date.now() + 2 * 60 * 1000; // 2 minutes max
  while (Date.now() < timeoutAt) {
    const res = await fetch(monitorUrl);
    if (res.status === 303 || res.status === 202) {
      const data = (await res.json()) as { status?: string; percentageComplete?: number };
      if (data.status === 'completed') return;
      if (data.status === 'failed' || data.status === 'deleteFailed') {
        throw new Error(`Graph copy failed: ${JSON.stringify(data)}`);
      }
    } else if (res.ok) {
      // Monitor may redirect-fetch the resulting item directly on completion.
      return;
    } else {
      throw new Error(`Graph copy monitor returned ${res.status}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Graph copy timed out after 2 minutes');
}

const PLACEHOLDER_PATTERN = /\[PROJECT\s*CODE\]/gi;

async function substitutePlaceholdersRecursive(
  driveId: string,
  folderId: string,
  projectCode: string,
): Promise<void> {
  let url: string | null = `/drives/${driveId}/items/${folderId}/children?$select=id,name,folder&$top=200`;
  // Note: children can paginate via @odata.nextLink — follow until exhausted.
  while (url) {
    const page: {
      value: Array<{ id: string; name: string; folder?: object }>;
      '@odata.nextLink'?: string;
    } = await graph('GET', url);
    for (const child of page.value) {
      if (!child.folder) continue;
      let nextId = child.id;
      if (PLACEHOLDER_PATTERN.test(child.name)) {
        // Reset regex state between matches (lastIndex is stateful on /g regexes).
        PLACEHOLDER_PATTERN.lastIndex = 0;
        const renamed = child.name.replace(PLACEHOLDER_PATTERN, projectCode);
        const updated = await graph<DriveItem>('PATCH', `/drives/${driveId}/items/${child.id}`, {
          name: renamed,
        });
        nextId = updated.id;
      }
      // Recurse into subfolders — templates can be nested.
      await substitutePlaceholdersRecursive(driveId, nextId, projectCode);
    }
    url = page['@odata.nextLink'] ?? null;
  }
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
