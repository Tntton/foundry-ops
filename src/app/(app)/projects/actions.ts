'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ProjectStage } from '@prisma/client';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { isInternalProject, hasFixedWindow } from '@/lib/project-kind';
import { emitUserUpdateMany, notifyAdminPool } from '@/server/user-updates';

export type MoveProjectState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string; from: ProjectStage; to: ProjectStage };

const MoveSchema = z.object({
  projectId: z.string().min(1),
  // Includes the internal-only lanes (standing / benched) added when
  // FHP projects got their own kanban band. Cross-band drops are
  // rejected below by the band-validity check, not here.
  toStage: z.enum([
    'kickoff',
    'delivery',
    'closing',
    'archived',
    'standing',
    'benched',
  ]),
});

const INTERNAL_ONLY_STAGES: ProjectStage[] = ['standing', 'benched'];
const CLIENT_ONLY_STAGES: ProjectStage[] = ['closing', 'archived'];

/**
 * Drag-and-drop stage transition for the projects kanban. Server-side gate:
 *   - Only super_admin / admin / partner OR the owning manager / primary
 *     partner can move a project.
 *   - Moving to `closing` or `archived` requires both theoretical start +
 *     end dates to be set (matches the reconciliation gate already enforced
 *     in /projects/[code]/settings + the archive flow).
 *   - Moving to `archived` stamps `actualEndDate = today` if it isn't set.
 */
export async function moveProject(
  _prev: MoveProjectState,
  formData: FormData,
): Promise<MoveProjectState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const parsed = MoveSchema.safeParse({
    projectId: formData.get('projectId'),
    toStage: formData.get('toStage'),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  const project = await prisma.project.findUnique({
    where: { id: parsed.data.projectId },
    select: {
      id: true,
      code: true,
      stage: true,
      managerId: true,
      primaryPartnerId: true,
      startDate: true,
      endDate: true,
      actualEndDate: true,
    },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  const canEdit =
    hasAnyRole(session, ['super_admin', 'admin']) ||
    project.managerId === session.person.id ||
    project.primaryPartnerId === session.person.id ||
    (hasAnyRole(session, ['partner']) &&
      project.primaryPartnerId === session.person.id);
  if (!canEdit) {
    return {
      status: 'error',
      message: 'Only project leadership can change a project stage.',
    };
  }

  const { toStage } = parsed.data;
  if (project.stage === toStage) {
    return {
      status: 'success',
      message: 'No change.',
      from: project.stage,
      to: toStage,
    };
  }

  // Cross-band guard. Internal-only lanes (standing/benched) reject
  // client engagements; client-only lanes (closing/archived) reject
  // internal FHP projects. Keeps the projects board honest — e.g. you
  // can't accidentally drag a client engagement into "Standing".
  const projIsInternal = isInternalProject(project.code);
  if (INTERNAL_ONLY_STAGES.includes(toStage) && !projIsInternal) {
    return {
      status: 'error',
      message: `${toStage} is reserved for internal FHP projects. Move ${project.code} to closing or archived instead.`,
    };
  }
  if (CLIENT_ONLY_STAGES.includes(toStage) && projIsInternal) {
    return {
      status: 'error',
      message: `${toStage} is reserved for client engagements. Move ${project.code} to standing or benched instead.`,
    };
  }

  // Reconciliation gate: closing/archived needs both theoretical dates
  // set — but only for projects that carry a fixed window (client
  // engagements). Internal FHP projects never hit those lanes anyway
  // (rejected above), so this branch is effectively client-only.
  if (
    hasFixedWindow(project.code) &&
    (toStage === 'closing' || toStage === 'archived') &&
    (!project.startDate || !project.endDate)
  ) {
    return {
      status: 'error',
      message: `Set both theoretical start + end on ${project.code} before moving to ${toStage}.`,
    };
  }

  const stampActualEnd =
    toStage === 'archived' && !project.actualEndDate ? new Date() : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: project.id },
        data: {
          stage: toStage,
          ...(stampActualEnd ? { actualEndDate: stampActualEnd } : {}),
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'stage_changed',
        entity: {
          type: 'project',
          id: project.id,
          before: { stage: project.stage },
          after: {
            stage: toStage,
            ...(stampActualEnd
              ? { actualEndDate: stampActualEnd.toISOString() }
              : {}),
          },
        },
        source: 'web',
      });

      // Project-team feed entry — every active team member, the
      // partner, and the manager get a UserUpdate row. Self-edit
      // (admin moving their own project) is filtered. Major
      // transitions (delivery → closing → archived) also fan out to
      // the admin pool so leadership has visibility on which jobs
      // wrapped up in the period.
      const team = await tx.projectTeam.findMany({
        where: { projectId: project.id },
        select: { personId: true },
      });
      const stakeholderIds = new Set<string>([
        project.primaryPartnerId,
        project.managerId,
        ...team.map((t) => t.personId),
      ]);
      stakeholderIds.delete(session.person.id);
      await emitUserUpdateMany(tx, [...stakeholderIds], {
        kind: 'project_stage_changed',
        title: `${project.code} moved to ${toStage}`,
        body: `From ${project.stage} → ${toStage}.`,
        href: `/projects/${project.code}`,
        entityType: 'project',
        entityId: project.id,
      });
      // Admin-pool fan-out only for the headline transitions —
      // delivery→closing and anything→archived are the ones that
      // matter for firm-level visibility. Skip mid-band shuffles
      // (kickoff↔delivery, standing↔benched) so we don't spam.
      const headlineTransition =
        toStage === 'closing' || toStage === 'archived';
      if (headlineTransition) {
        await notifyAdminPool(tx, {
          actorPersonId: session.person.id,
          kind: 'project_stage_changed',
          title: `${project.code} → ${toStage}`,
          body: `Stage moved by ${session.person.id === project.primaryPartnerId ? 'lead partner' : session.person.id === project.managerId ? 'manager' : 'admin'}.`,
          href: `/projects/${project.code}`,
          entityType: 'project',
          entityId: project.id,
        });
      }
    });
  } catch (err) {
    console.error('[project.move] failed:', err);
    return { status: 'error', message: 'Move failed — try again.' };
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${project.code}`);
  revalidatePath('/');
  return {
    status: 'success',
    message: `${project.code} moved to ${toStage}.`,
    from: project.stage,
    to: toStage,
  };
}
