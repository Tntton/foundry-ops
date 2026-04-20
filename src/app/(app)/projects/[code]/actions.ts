'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { provisionProjectFolder } from '@/server/integrations/sharepoint';

export type ProvisionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

export async function provisionSharePoint(
  projectCode: string,
  _prev: ProvisionState,
  _formData: FormData,
): Promise<ProvisionState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const project = await prisma.project.findUnique({
    where: { code: projectCode },
    include: { client: { select: { code: true, legalName: true, tradingName: true } } },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  try {
    const result = await provisionProjectFolder(
      project.client.code,
      project.client.tradingName ?? project.client.legalName,
      project.code,
    );
    if (!result) {
      return {
        status: 'error',
        message:
          'SharePoint not configured (SHAREPOINT_SITE_URL is unset). Ask admin to configure it.',
      };
    }
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: project.id },
        data: {
          sharepointFolderUrl: result.teamUrl,
          sharepointAdminFolderUrl: result.adminUrl,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'provisioned',
        entity: {
          type: 'project_sharepoint',
          id: project.id,
          after: {
            sharepointFolderUrl: result.teamUrl,
            sharepointAdminFolderUrl: result.adminUrl,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project.provisionSharePoint] failed:', err);
    return { status: 'error', message: `Provisioning failed: ${(err as Error).message}` };
  }

  revalidatePath(`/projects/${projectCode}`);
  return { status: 'success', message: 'SharePoint folder ready.' };
}
