'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { provisionProjectFolder } from '@/server/integrations/sharepoint';
import { getXeroIntegration } from '@/server/integrations/xero';
import { ensureProjectTrackingOption } from '@/server/integrations/xero-projects';

const ProjectCreate = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9]{2,9}$/u, '3-10 uppercase letters/digits, letter first'),
    clientId: z.string().min(1, 'Client is required'),
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    contractValueDollars: z.coerce.number().min(0).max(10_000_000),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    primaryPartnerId: z.string().min(1),
    managerId: z.string().min(1),
  })
  .refine((v) => v.endDate.getTime() > v.startDate.getTime(), {
    message: 'End date must be after start date',
    path: ['endDate'],
  });

export type NewProjectState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function createProject(
  _prev: NewProjectState,
  formData: FormData,
): Promise<NewProjectState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const raw = {
    code: String(formData.get('code') ?? '').toUpperCase(),
    clientId: formData.get('clientId'),
    name: formData.get('name'),
    description: formData.get('description') || null,
    contractValueDollars: formData.get('contractValueDollars'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    primaryPartnerId: formData.get('primaryPartnerId'),
    managerId: formData.get('managerId'),
  };

  const parsed = ProjectCreate.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }

  const data = parsed.data;

  const existingCode = await prisma.project.findUnique({ where: { code: data.code } });
  if (existingCode) {
    return {
      status: 'error',
      message: 'Code already in use.',
      fieldErrors: { code: 'Already used' },
    };
  }

  const contractValue = Math.round(data.contractValueDollars * 100);
  const fromDealIdRaw = formData.get('fromDealId');
  const fromDealId = typeof fromDealIdRaw === 'string' && fromDealIdRaw ? fromDealIdRaw : null;
  let newCode: string;
  let newProjectId: string;
  let clientCode: string;
  let clientName: string;
  try {
    ({ newCode, newProjectId, clientCode, clientName } = await prisma.$transaction(async (tx) => {
      const client = await tx.client.findUniqueOrThrow({
        where: { id: data.clientId },
        select: { code: true, legalName: true, tradingName: true },
      });
      const project = await tx.project.create({
        data: {
          code: data.code,
          clientId: data.clientId,
          name: data.name,
          description: data.description,
          contractValue,
          startDate: data.startDate,
          endDate: data.endDate,
          primaryPartnerId: data.primaryPartnerId,
          managerId: data.managerId,
          stage: 'kickoff',
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'project',
          id: project.id,
          after: {
            code: project.code,
            clientId: project.clientId,
            name: project.name,
            contractValue: project.contractValue,
            primaryPartnerId: project.primaryPartnerId,
            managerId: project.managerId,
            stage: project.stage,
          },
        },
        source: 'web',
      });
      // If this project came from a deal, link them and stamp the won stage.
      if (fromDealId) {
        const deal = await tx.deal.findUnique({ where: { id: fromDealId } });
        if (deal && !deal.convertedProjectId) {
          await tx.deal.update({
            where: { id: fromDealId },
            data: {
              convertedProjectId: project.id,
              stage: deal.stage === 'won' ? deal.stage : 'won',
            },
          });
          await writeAudit(tx, {
            actor: { type: 'person', id: session.person.id },
            action: 'converted_to_project',
            entity: {
              type: 'deal',
              id: fromDealId,
              before: {
                stage: deal.stage,
                convertedProjectId: deal.convertedProjectId,
              },
              after: {
                stage: 'won',
                convertedProjectId: project.id,
                projectCode: project.code,
              },
            },
            source: 'web',
          });
        }
      }
      return {
        newCode: project.code,
        newProjectId: project.id,
        clientCode: client.code,
        clientName: client.tradingName ?? client.legalName,
      };
    }));
  } catch (err) {
    console.error('[project.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  // SharePoint folder provisioning (best-effort; if it fails we don't roll back
  // the project — surfaces as a "Provision SharePoint" button on the Files tab
  // for retry).
  try {
    const result = await provisionProjectFolder(clientCode, clientName, newCode);
    if (result) {
      await prisma.project.update({
        where: { id: newProjectId },
        data: {
          sharepointFolderUrl: result.teamUrl,
          sharepointAdminFolderUrl: result.adminUrl,
        },
      });
    }
  } catch (err) {
    console.error('[project.create] SharePoint provisioning failed:', err);
  }

  // Xero tracking-category option — best-effort; retry button on the project
  // detail page if Xero isn't connected yet or the API is flaky.
  try {
    const xeroRow = await getXeroIntegration();
    if (xeroRow?.status === 'connected') {
      await ensureProjectTrackingOption(newProjectId);
    }
  } catch (err) {
    console.error('[project.create] Xero tracking-category provisioning failed:', err);
  }

  revalidatePath('/projects');
  if (fromDealId) {
    revalidatePath('/bd');
    revalidatePath(`/bd/${fromDealId}`);
  }
  redirect(`/projects/${newCode}`);
}
