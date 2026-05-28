'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { PartnerContributionRole } from '@prisma/client';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { emitUserUpdateMany } from '@/server/user-updates';

export type ContributionsSaveState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const RoleEnum = z.enum([
  'bd_won',
  'led',
  'directly_supported',
  'partially_supported',
]);

const ContributionLineSchema = z.object({
  personId: z.string().min(1),
  role: RoleEnum,
  contributionPct: z.coerce.number().int().min(0).max(100),
  notes: z.string().trim().max(500).nullable().optional(),
});

const RootSchema = z.object({
  projectId: z.string().min(1),
  contributions: z.array(ContributionLineSchema).max(40),
});

/**
 * Replace-by-(personId, role) save: any (personId, role) pair in the
 * payload upserts; pairs that disappear from the payload are deleted.
 * Auth: super_admin/admin OR project's primary partner / manager.
 */
export async function saveProjectPartnerContributions(
  projectId: string,
  _prev: ContributionsSaveState,
  formData: FormData,
): Promise<ContributionsSaveState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { code: true, primaryPartnerId: true, managerId: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  const isAdmin = hasAnyRole(session, ['super_admin', 'admin']);
  const isLead =
    project.primaryPartnerId === session.person.id ||
    project.managerId === session.person.id;
  if (!isAdmin && !isLead) {
    return { status: 'error', message: 'Not authorized' };
  }

  const personIds = formData.getAll('personId').map(String);
  const roles = formData.getAll('role').map(String);
  const pcts = formData.getAll('contributionPct').map(String);
  const notes = formData.getAll('notes').map((v) =>
    String(v).trim() || null,
  );
  const contributions = personIds.map((personId, i) => ({
    personId,
    role: roles[i] ?? 'led',
    contributionPct: pcts[i] ?? '0',
    notes: notes[i] ?? null,
  }));

  const parsed = RootSchema.safeParse({ projectId, contributions });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.projectPartnerContribution.findMany({
        where: { projectId },
      });

      // Compute the (personId|role) keyset for the desired state.
      const desiredKeys = new Set(
        parsed.data.contributions.map((c) => `${c.personId}|${c.role}`),
      );
      // Delete any rows not in the desired set.
      for (const existing of before) {
        const key = `${existing.personId}|${existing.role}`;
        if (!desiredKeys.has(key)) {
          await tx.projectPartnerContribution.delete({
            where: { id: existing.id },
          });
        }
      }
      // Upsert by composite unique (projectId, personId, role).
      for (const c of parsed.data.contributions) {
        await tx.projectPartnerContribution.upsert({
          where: {
            projectId_personId_role: {
              projectId,
              personId: c.personId,
              role: c.role as PartnerContributionRole,
            },
          },
          create: {
            projectId,
            personId: c.personId,
            role: c.role as PartnerContributionRole,
            contributionPct: c.contributionPct,
            notes: c.notes ?? null,
          },
          update: {
            contributionPct: c.contributionPct,
            notes: c.notes ?? null,
          },
        });
      }

      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'project_partner_contributions',
          id: projectId,
          before: { count: before.length },
          after: { count: parsed.data.contributions.length },
        },
        source: 'web',
      });

      // Per-person feed: notify every partner whose row changed (added,
      // removed, or has a different pct/role). Self-edits skipped so
      // the partner editing the table doesn't get a chime for their
      // own action. We collapse multiple role rows for the same
      // person into a single update row.
      const beforeByPerson = new Map<string, typeof before>();
      for (const b of before) {
        const arr = beforeByPerson.get(b.personId) ?? [];
        arr.push(b);
        beforeByPerson.set(b.personId, arr);
      }
      const afterByPerson = new Map<
        string,
        Array<{ role: string; contributionPct: number }>
      >();
      for (const a of parsed.data.contributions) {
        const arr = afterByPerson.get(a.personId) ?? [];
        arr.push({ role: a.role, contributionPct: a.contributionPct });
        afterByPerson.set(a.personId, arr);
      }
      const changedPersonIds = new Set<string>();
      for (const [personId, beforeRows] of beforeByPerson) {
        const afterRows = afterByPerson.get(personId) ?? [];
        if (
          afterRows.length !== beforeRows.length ||
          beforeRows.some(
            (br) =>
              !afterRows.some(
                (ar) =>
                  ar.role === br.role &&
                  ar.contributionPct === br.contributionPct,
              ),
          )
        ) {
          changedPersonIds.add(personId);
        }
      }
      for (const personId of afterByPerson.keys()) {
        if (!beforeByPerson.has(personId)) changedPersonIds.add(personId);
      }
      changedPersonIds.delete(session.person.id);
      await emitUserUpdateMany(tx, [...changedPersonIds], {
        kind: 'contribution_changed',
        title: `Your contribution on ${project.code} was updated`,
        body: null,
        href: `/projects/${project.code}`,
        entityType: 'project',
        entityId: projectId,
      });
    });
  } catch (err) {
    console.error('[contributions.save] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/projects/${project.code}`);
  revalidatePath('/partners');
  return { status: 'success' };
}
