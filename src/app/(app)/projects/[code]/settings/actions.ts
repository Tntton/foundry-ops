'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const ProjectEditSchema = z
  .object({
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    stage: z.enum(['kickoff', 'delivery', 'closing', 'archived']),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    contractValueDollars: z.coerce.number().min(0).max(10_000_000),
    primaryPartnerId: z.string().min(1),
    managerId: z.string().min(1),
    actualEndDate: z.coerce.date().optional().nullable().or(z.literal('').transform(() => null)),
  })
  .refine((v) => v.endDate.getTime() > v.startDate.getTime(), {
    message: 'End date must be after start date',
    path: ['endDate'],
  });

export type ProjectEditState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function updateProject(
  projectId: string,
  _prev: ProjectEditState,
  formData: FormData,
): Promise<ProjectEditState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = ProjectEditSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description') || null,
    stage: formData.get('stage'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    contractValueDollars: formData.get('contractValueDollars'),
    primaryPartnerId: formData.get('primaryPartnerId'),
    managerId: formData.get('managerId'),
    actualEndDate: formData.get('actualEndDate') || null,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }
  const data = parsed.data;

  const existing = await prisma.project.findUnique({ where: { id: projectId } });
  if (!existing) return { status: 'error', message: 'Project not found' };

  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && existing.managerId !== session.person.id && existing.primaryPartnerId !== session.person.id) {
    return { status: 'error', message: 'Only project leadership / admin can edit settings.' };
  }

  const contractValue = Math.round(data.contractValueDollars * 100);
  const actualEndDate = data.actualEndDate instanceof Date ? data.actualEndDate : null;

  const before = {
    name: existing.name,
    description: existing.description,
    stage: existing.stage,
    startDate: existing.startDate.toISOString(),
    endDate: existing.endDate.toISOString(),
    actualEndDate: existing.actualEndDate ? existing.actualEndDate.toISOString() : null,
    contractValue: existing.contractValue,
    primaryPartnerId: existing.primaryPartnerId,
    managerId: existing.managerId,
  };
  const after = {
    name: data.name,
    description: data.description,
    stage: data.stage,
    startDate: data.startDate.toISOString(),
    endDate: data.endDate.toISOString(),
    actualEndDate: actualEndDate ? actualEndDate.toISOString() : null,
    contractValue,
    primaryPartnerId: data.primaryPartnerId,
    managerId: data.managerId,
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: {
          name: data.name,
          description: data.description,
          stage: data.stage,
          startDate: data.startDate,
          endDate: data.endDate,
          actualEndDate,
          contractValue,
          primaryPartnerId: data.primaryPartnerId,
          managerId: data.managerId,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: { type: 'project', id: projectId, before, after },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project.update] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${existing.code}`);
  redirect(`/projects/${existing.code}`);
}
