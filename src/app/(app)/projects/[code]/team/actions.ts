'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

export type TeamQuickAddState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

const AddSchema = z.object({
  personId: z.string().min(1),
  roleOnProject: z.string().trim().min(1).max(80),
  allocationPct: z.coerce.number().int().min(0).max(100),
});

/**
 * One-shot add of a person to a project team. Used by the project overview's
 * inline team quick-add — keeps the user on the page instead of routing to
 * /team/edit. If the person is already on the team, returns a friendly
 * "already on team" message rather than throwing on the unique constraint.
 */
export async function addProjectTeamMember(
  projectId: string,
  _prev: TeamQuickAddState,
  formData: FormData,
): Promise<TeamQuickAddState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = AddSchema.safeParse({
    personId: formData.get('personId'),
    roleOnProject: formData.get('roleOnProject'),
    allocationPct: formData.get('allocationPct'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, managerId: true, primaryPartnerId: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (
    !canAll &&
    project.managerId !== session.person.id &&
    project.primaryPartnerId !== session.person.id
  ) {
    return {
      status: 'error',
      message: 'Only project leadership can add team members.',
    };
  }

  const existing = await prisma.projectTeam.findUnique({
    where: {
      projectId_personId: {
        projectId: project.id,
        personId: parsed.data.personId,
      },
    },
  });
  if (existing) {
    return {
      status: 'error',
      message: 'Already on team. Edit role / allocation in Manage team.',
    };
  }

  const person = await prisma.person.findUnique({
    where: { id: parsed.data.personId },
    select: { firstName: true, lastName: true },
  });
  if (!person) return { status: 'error', message: 'Person not found' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.projectTeam.create({
        data: {
          projectId: project.id,
          personId: parsed.data.personId,
          roleOnProject: parsed.data.roleOnProject,
          allocationPct: parsed.data.allocationPct,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'team_member_added',
        entity: {
          type: 'project',
          id: project.id,
          after: {
            personId: parsed.data.personId,
            roleOnProject: parsed.data.roleOnProject,
            allocationPct: parsed.data.allocationPct,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project.addTeamMember] failed:', err);
    return { status: 'error', message: 'Add failed — try again.' };
  }

  revalidatePath(`/projects/${project.code}`);
  revalidatePath('/resource-planning');
  return {
    status: 'success',
    message: `${person.firstName} ${person.lastName} added at ${parsed.data.allocationPct}%.`,
  };
}

const RemoveSchema = z.object({ personId: z.string().min(1) });

export async function removeProjectTeamMember(
  projectId: string,
  _prev: TeamQuickAddState,
  formData: FormData,
): Promise<TeamQuickAddState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = RemoveSchema.safeParse({ personId: formData.get('personId') });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, managerId: true, primaryPartnerId: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (
    !canAll &&
    project.managerId !== session.person.id &&
    project.primaryPartnerId !== session.person.id
  ) {
    return { status: 'error', message: 'Not authorized.' };
  }

  // Refuse remove if the person has logged hours on this project — they need
  // the membership for resourcing accuracy. Manage-team page handles archive.
  const hours = await prisma.timesheetEntry.count({
    where: { projectId: project.id, personId: parsed.data.personId },
  });
  if (hours > 0) {
    return {
      status: 'error',
      message:
        "Person has timesheet entries on this project — keep them on the team for resourcing. Use Manage team to drop their allocation to 0%.",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.projectTeam.delete({
        where: {
          projectId_personId: {
            projectId: project.id,
            personId: parsed.data.personId,
          },
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'team_member_removed',
        entity: {
          type: 'project',
          id: project.id,
          before: { personId: parsed.data.personId },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project.removeTeamMember] failed:', err);
    return { status: 'error', message: 'Remove failed — try again.' };
  }

  revalidatePath(`/projects/${project.code}`);
  revalidatePath('/resource-planning');
  return { status: 'success', message: 'Removed from team.' };
}
