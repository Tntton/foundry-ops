'use server';

import { revalidatePath } from 'next/cache';
import type { PoolStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { writeAudit } from '@/server/audit';
import { emitUserUpdate } from '@/server/user-updates';

export type PoolStatusActionState =
  | { ok: true }
  | { ok: false; message: string };

const VALID: PoolStatus[] = [
  'on_project',
  'previous_project',
  'never_on_project',
  'on_sabbatical',
];

/** A "project pick" entry surfaced to the right-click menu when the
 *  super-admin selects "On project" for a person not currently on any
 *  active team. */
export type ActiveProjectPick = {
  projectId: string;
  code: string;
  name: string;
  stage: string;
  alreadyOnTeam: boolean;
};

/**
 * List active projects for the on-project picker. Returns every non-
 * archived project flagged whether the target person is already on the
 * team. Used by the right-click "On project" follow-up dialog so the
 * super-admin can attach the person to ≥1 project before the status
 * gets pinned to on_project.
 */
export async function listActiveProjectsForPick(
  personId: string,
): Promise<ActiveProjectPick[]> {
  const session = await getSession();
  if (!session?.isRealSuperAdmin) return [];
  const [projects, memberships] = await Promise.all([
    prisma.project.findMany({
      where: { stage: { not: 'archived' } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, stage: true },
    }),
    prisma.projectTeam.findMany({
      where: { personId },
      select: { projectId: true },
    }),
  ]);
  const onTeam = new Set(memberships.map((m) => m.projectId));
  return projects.map((p) => ({
    projectId: p.id,
    code: p.code,
    name: p.name,
    stage: p.stage,
    alreadyOnTeam: onTeam.has(p.id),
  }));
}

/**
 * Set or clear the super-admin pool-status override for a person. Only
 * super_admin can call (matches the right-click menu visibility).
 *
 *   status === null  → clear override (revert to computed)
 *   status === enum  → force this status until cleared
 *
 * Audited as a person-update so the trail captures who switched whom
 * and when. Revalidates resource-planning, directory and the profile
 * page so the colour pip propagates without a hard reload.
 */
export async function setPoolStatusOverride(
  personId: string,
  status: PoolStatus | null,
  /** When `status === 'on_project'` and the person doesn't already
   *  hold an active project team membership, the right-click menu MUST
   *  pass at least one projectId so we can attach them. Defaults
   *  empty for the other statuses (clearing / sabbatical / etc.). */
  attachProjectIds: string[] = [],
): Promise<PoolStatusActionState> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Not signed in' };
  // Use real super_admin status (not the view-as overlay) so a super
  // admin in view-as=staff mode can't accidentally lose the ability to
  // exit, and so a non-super-admin overlaid as super-admin can't engage.
  if (!session.isRealSuperAdmin) {
    return { ok: false, message: 'Only super admins can change pool status.' };
  }
  if (status !== null && !VALID.includes(status)) {
    return { ok: false, message: 'Invalid status value.' };
  }
  const target = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      poolStatusOverride: true,
      firstName: true,
      lastName: true,
      projectTeamMemberships: {
        where: { project: { stage: { not: 'archived' } } },
        select: { projectId: true },
      },
    },
  });
  if (!target) return { ok: false, message: 'Person not found' };
  const activeMemberships = target.projectTeamMemberships;
  // Gate "On project" — must end the action with at least one active
  // ProjectTeam row, either pre-existing or freshly attached.
  if (status === 'on_project') {
    const willEndUpOnAtLeastOne =
      activeMemberships.length > 0 || attachProjectIds.length > 0;
    if (!willEndUpOnAtLeastOne) {
      return {
        ok: false,
        message:
          'Pick at least one project to add this person to before flagging them on-project.',
      };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Attach the person to each requested project (skipping any
      // membership they already hold). Default 0% allocation + role
      // "Team" — partners can refine on the Team tab afterwards.
      if (attachProjectIds.length > 0) {
        for (const projectId of attachProjectIds) {
          await tx.projectTeam.upsert({
            where: { projectId_personId: { projectId, personId } },
            create: {
              projectId,
              personId,
              roleOnProject: 'Team',
              allocationPct: 0,
            },
            update: {},
          });
        }
      }

      const overrideChanged = target.poolStatusOverride !== status;
      if (overrideChanged) {
        await tx.person.update({
          where: { id: personId },
          data: { poolStatusOverride: status },
        });
      }

      // Audit only when something actually moved (override flipped or a
      // membership got added). Keeps the trail honest.
      if (overrideChanged || attachProjectIds.length > 0) {
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'updated',
          entity: {
            type: 'person',
            id: personId,
            before: { poolStatusOverride: target.poolStatusOverride },
            after: {
              via: 'pool_status_override',
              poolStatusOverride: status,
              attachedProjectIds: attachProjectIds,
              target: `${target.firstName} ${target.lastName}`,
            },
          },
          source: 'web',
        });

        // Per-person feed: notify the target only when the override
        // actually changed (skip if we just attached project rows).
        // Self-edits unlikely here (super-admin uses this on others)
        // but skip just in case.
        if (overrideChanged && personId !== session.person.id) {
          const statusLabel = status
            ? status.replace(/_/g, ' ')
            : 'computed (no override)';
          await emitUserUpdate(tx, {
            personId,
            kind: 'pool_status_changed',
            title: `Your engagement status changed to ${statusLabel}`,
            body: status === 'on_sabbatical'
              ? 'Logged as sabbatical — inputs may be paused.'
              : null,
            href: `/directory/people/${personId}`,
            entityType: 'person',
            entityId: personId,
          });
        }
      }
    });
  } catch (err) {
    console.error('[pool-status.set] failed:', err);
    return { ok: false, message: 'Save failed — try again.' };
  }
  revalidatePath('/resource-planning');
  revalidatePath('/directory');
  revalidatePath(`/directory/people/${personId}`);
  return { ok: true };
}
