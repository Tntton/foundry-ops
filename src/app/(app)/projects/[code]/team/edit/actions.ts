'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const TeamMemberSchema = z.object({
  personId: z.string().min(1),
  roleOnProject: z.string().trim().min(1).max(80),
  allocationPct: z.coerce.number().int().min(0).max(100),
});

const SchemaRoot = z.object({
  projectId: z.string().min(1),
  members: z.array(TeamMemberSchema),
});

export type TeamEditState = { status: 'idle' } | { status: 'error'; message: string };

export async function saveProjectTeam(
  _prev: TeamEditState,
  formData: FormData,
): Promise<TeamEditState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const projectId = String(formData.get('projectId') ?? '');
  const personIds = formData.getAll('personId').map(String);
  const roles = formData.getAll('roleOnProject').map(String);
  const allocs = formData.getAll('allocationPct').map(String);
  const members = personIds.map((personId, i) => ({
    personId,
    roleOnProject: roles[i] ?? '',
    allocationPct: Number(allocs[i] ?? 0),
  }));

  const parsed = SchemaRoot.safeParse({ projectId, members });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, managerId: true, primaryPartnerId: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  // Manager / partner can edit own; admin+ can edit any.
  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && project.managerId !== session.person.id && project.primaryPartnerId !== session.person.id) {
    return { status: 'error', message: 'Only the project partner/manager/admin can edit team.' };
  }

  const before = await prisma.projectTeam.findMany({ where: { projectId } });
  const beforeIds = new Set(before.map((t) => t.personId));
  const afterIds = new Set(parsed.data.members.map((m) => m.personId));

  try {
    await prisma.$transaction(async (tx) => {
      // Delete removed
      for (const existing of before) {
        if (!afterIds.has(existing.personId)) {
          await tx.projectTeam.delete({ where: { id: existing.id } });
        }
      }
      // Upsert current
      for (const m of parsed.data.members) {
        await tx.projectTeam.upsert({
          where: {
            projectId_personId: { projectId, personId: m.personId },
          },
          create: {
            projectId,
            personId: m.personId,
            roleOnProject: m.roleOnProject,
            allocationPct: m.allocationPct,
          },
          update: {
            roleOnProject: m.roleOnProject,
            allocationPct: m.allocationPct,
          },
        });
      }

      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'project_team',
          id: projectId,
          before: { members: before.map((b) => ({ personId: b.personId, role: b.roleOnProject, alloc: b.allocationPct })) },
          after: {
            members: parsed.data.members,
            added: parsed.data.members.filter((m) => !beforeIds.has(m.personId)).map((m) => m.personId),
            removed: before.filter((b) => !afterIds.has(b.personId)).map((b) => b.personId),
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project-team.save] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/projects/${project.code}`);
  redirect(`/projects/${project.code}`);
}
