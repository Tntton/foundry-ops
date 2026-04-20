'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const MILESTONE_STATUSES = ['not_started', 'in_progress', 'delivered', 'invoiced'] as const;

const MilestoneCreateSchema = z.object({
  projectId: z.string().min(1),
  label: z.string().trim().min(1).max(200),
  dueDate: z.coerce.date(),
  amountDollars: z.coerce.number().min(0).max(10_000_000),
  status: z.enum(MILESTONE_STATUSES).default('not_started'),
});

export type MilestoneState = { status: 'idle' } | { status: 'error'; message: string };

export async function createMilestone(
  _prev: MilestoneState,
  formData: FormData,
): Promise<MilestoneState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = MilestoneCreateSchema.safeParse({
    projectId: formData.get('projectId'),
    label: formData.get('label'),
    dueDate: formData.get('dueDate'),
    amountDollars: formData.get('amountDollars'),
    status: formData.get('status') || 'not_started',
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const project = await prisma.project.findUnique({
    where: { id: parsed.data.projectId },
    select: { id: true, code: true, managerId: true, primaryPartnerId: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };
  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && project.managerId !== session.person.id && project.primaryPartnerId !== session.person.id) {
    return { status: 'error', message: 'Only project leadership / admin can edit milestones.' };
  }

  const amount = Math.round(parsed.data.amountDollars * 100);
  try {
    await prisma.$transaction(async (tx) => {
      const milestone = await tx.milestone.create({
        data: {
          projectId: parsed.data.projectId,
          label: parsed.data.label,
          dueDate: parsed.data.dueDate,
          amount,
          status: parsed.data.status,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'milestone',
          id: milestone.id,
          after: {
            projectId: milestone.projectId,
            label: milestone.label,
            dueDate: milestone.dueDate.toISOString(),
            amount,
            status: milestone.status,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[milestone.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath(`/projects/${project.code}`);
  revalidatePath(`/projects/${project.code}/milestones`);
  return { status: 'idle' };
}

const MilestoneUpdateSchema = z.object({
  milestoneId: z.string().min(1),
  status: z.enum(MILESTONE_STATUSES),
});

export async function updateMilestoneStatus(
  _prev: MilestoneState,
  formData: FormData,
): Promise<MilestoneState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = MilestoneUpdateSchema.safeParse({
    milestoneId: formData.get('milestoneId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  const milestone = await prisma.milestone.findUnique({
    where: { id: parsed.data.milestoneId },
    include: { project: { select: { code: true, managerId: true, primaryPartnerId: true } } },
  });
  if (!milestone) return { status: 'error', message: 'Milestone not found' };
  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && milestone.project.managerId !== session.person.id && milestone.project.primaryPartnerId !== session.person.id) {
    return { status: 'error', message: 'Not authorized for this project.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.milestone.update({
        where: { id: milestone.id },
        data: { status: parsed.data.status },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'milestone',
          id: updated.id,
          before: { status: milestone.status },
          after: { status: updated.status },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[milestone.update] failed:', err);
    return { status: 'error', message: 'Update failed — try again.' };
  }

  revalidatePath(`/projects/${milestone.project.code}`);
  revalidatePath(`/projects/${milestone.project.code}/milestones`);
  return { status: 'idle' };
}
