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

const REORDER_LIMIT = 200;

// Reorder is disabled on the read-only "Closed" lane — historical
// projects don't carry priority. Internal-only history lanes don't
// exist (FHP projects use standing/benched which ARE rankable).
const PROJECT_REORDER_FORBIDDEN: ProjectStage[] = ['archived'];

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

// ─── Within-column priority ranking ────────────────────────────────
//
// `reorderProjectsInStage` accepts the full ordered list of project IDs
// in a single column and renumbers `sortOrder` 1..N for all of them.
// Volume is small (≤30 cards per column at firm scale) so renumbering
// every reorder is cheaper than maintaining fractional gaps.

export type ReorderState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const ReorderProjectsSchema = z.object({
  stage: z.enum([
    'kickoff',
    'delivery',
    'closing',
    'archived',
    'standing',
    'benched',
  ]),
  orderedIds: z.array(z.string().min(1)).min(1).max(REORDER_LIMIT),
});

export async function reorderProjectsInStage(
  _prev: ReorderState,
  formData: FormData,
): Promise<ReorderState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const orderedIdsRaw = formData.get('orderedIds');
  const parsed = ReorderProjectsSchema.safeParse({
    stage: formData.get('stage'),
    orderedIds:
      typeof orderedIdsRaw === 'string' && orderedIdsRaw.length > 0
        ? orderedIdsRaw.split(',')
        : [],
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid reorder' };
  }
  const { stage, orderedIds } = parsed.data;

  if (PROJECT_REORDER_FORBIDDEN.includes(stage)) {
    return {
      status: 'error',
      message: `${stage} is read-only history — priority ranking is disabled.`,
    };
  }

  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner', 'manager'])) {
    return {
      status: 'error',
      message: 'Not authorized to reorder the projects board.',
    };
  }

  // Pull current rows so we can (a) validate every id is real + in the
  // claimed stage, and (b) compute before/after for the audit delta.
  const existing = await prisma.project.findMany({
    where: { id: { in: orderedIds }, stage },
    select: { id: true, code: true, sortOrder: true },
  });
  if (existing.length !== orderedIds.length) {
    return {
      status: 'error',
      message: 'Card list out of sync — refresh and try again.',
    };
  }
  const existingById = new Map(existing.map((p) => [p.id, p]));
  const before = orderedIds.map((id) => {
    const row = existingById.get(id);
    return { id, code: row?.code ?? null, sortOrder: row?.sortOrder ?? null };
  });

  // Renumber 1..N in a single transaction so concurrent reorders can't
  // interleave to produce duplicate ranks.
  try {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i += 1) {
        await tx.project.update({
          where: { id: orderedIds[i]! },
          data: { sortOrder: i + 1 },
        });
      }
      const after = orderedIds.map((id, i) => ({
        id,
        code: existingById.get(id)?.code ?? null,
        sortOrder: i + 1,
      }));
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'reordered',
        entity: {
          type: 'project_kanban',
          id: `stage:${stage}`,
          before: { stage, order: before },
          after: { stage, order: after },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project.reorder] failed:', err);
    return { status: 'error', message: 'Reorder failed — try again.' };
  }

  revalidatePath('/projects');
  return { status: 'success' };
}
