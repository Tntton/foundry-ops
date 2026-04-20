'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

export type ProjectArchiveState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const ConfirmSchema = z.object({
  confirmCode: z.string().trim(),
  actualEndDate: z.coerce.date().optional(),
});

/**
 * Ownership check: super_admin / admin always; partner + manager only for the
 * projects they own. Matches the project.edit spirit from CAPABILITY_ROLES.
 */
async function ensureCanActOnProject(
  projectId: string,
  sessionPersonId: string,
  roles: readonly Role[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (roles.includes('super_admin') || roles.includes('admin')) {
    return { ok: true };
  }
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { primaryPartnerId: true, managerId: true },
  });
  if (!p) return { ok: false, message: 'Project not found' };
  if (p.primaryPartnerId === sessionPersonId || p.managerId === sessionPersonId) {
    return { ok: true };
  }
  return { ok: false, message: 'Only the owning partner or manager can archive this project.' };
}

export async function archiveProject(
  projectId: string,
  _prev: ProjectArchiveState,
  formData: FormData,
): Promise<ProjectArchiveState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const own = await ensureCanActOnProject(
    projectId,
    session.person.id,
    session.person.roles,
  );
  if (!own.ok) return { status: 'error', message: own.message };

  const parsed = ConfirmSchema.safeParse({
    confirmCode: formData.get('confirmCode'),
    actualEndDate: formData.get('actualEndDate') || undefined,
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { status: 'error', message: 'Project not found' };

  if (parsed.data.confirmCode.toUpperCase() !== project.code) {
    return {
      status: 'error',
      message: `Code didn't match. To confirm, type "${project.code}" exactly.`,
    };
  }

  if (project.stage === 'archived') {
    return { status: 'error', message: 'Project is already archived.' };
  }

  const actualEndDate = parsed.data.actualEndDate ?? new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: { stage: 'archived', actualEndDate },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'archived',
        entity: {
          type: 'project',
          id: projectId,
          before: {
            stage: project.stage,
            actualEndDate: project.actualEndDate?.toISOString() ?? null,
          },
          after: { stage: 'archived', actualEndDate: actualEndDate.toISOString() },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project.archive] failed:', err);
    return { status: 'error', message: 'Archive failed — try again.' };
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${project.code}`);
  return { status: 'success' };
}

export async function reactivateProject(
  projectId: string,
  _prev: ProjectArchiveState,
  _formData: FormData,
): Promise<ProjectArchiveState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const own = await ensureCanActOnProject(
    projectId,
    session.person.id,
    session.person.roles,
  );
  if (!own.ok) return { status: 'error', message: own.message };

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { status: 'error', message: 'Project not found' };
  if (project.stage !== 'archived') {
    return { status: 'error', message: 'Project is not archived.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: { stage: 'delivery', actualEndDate: null },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'reactivated',
        entity: {
          type: 'project',
          id: projectId,
          before: {
            stage: 'archived',
            actualEndDate: project.actualEndDate?.toISOString() ?? null,
          },
          after: { stage: 'delivery', actualEndDate: null },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project.reactivate] failed:', err);
    return { status: 'error', message: 'Reactivate failed — try again.' };
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${project.code}`);
  return { status: 'success' };
}

/**
 * Hard delete — only allowed for super_admin, and only when the project has
 * zero financial children (invoices, bills, expenses, timesheet entries, deals).
 * Team, milestones, risks cascade via the schema. SharePoint folders and Xero
 * tracking options are *not* cleaned up — those live in external systems and
 * should be removed manually if needed.
 */
export async function deleteProject(
  projectId: string,
  _prev: ProjectArchiveState,
  formData: FormData,
): Promise<ProjectArchiveState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.delete');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = ConfirmSchema.safeParse({
    confirmCode: formData.get('confirmCode'),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { status: 'error', message: 'Project not found' };

  if (parsed.data.confirmCode.toUpperCase() !== project.code) {
    return {
      status: 'error',
      message: `Code didn't match. To confirm, type "${project.code}" exactly.`,
    };
  }

  const [invoices, bills, expenses, timesheets, deals] = await Promise.all([
    prisma.invoice.count({ where: { projectId } }),
    prisma.bill.count({ where: { projectId } }),
    prisma.expense.count({ where: { projectId } }),
    prisma.timesheetEntry.count({ where: { projectId } }),
    prisma.deal.count({ where: { convertedProjectId: projectId } }),
  ]);
  const blockers: string[] = [];
  if (invoices) blockers.push(`${invoices} invoice${invoices === 1 ? '' : 's'}`);
  if (bills) blockers.push(`${bills} bill${bills === 1 ? '' : 's'}`);
  if (expenses) blockers.push(`${expenses} expense${expenses === 1 ? '' : 's'}`);
  if (timesheets) blockers.push(`${timesheets} timesheet ${timesheets === 1 ? 'entry' : 'entries'}`);
  if (deals) blockers.push(`${deals} converted deal${deals === 1 ? '' : 's'}`);
  if (blockers.length) {
    return {
      status: 'error',
      message: `Can't delete — project still has ${blockers.join(', ')}. Archive instead.`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Write the audit first so it survives the cascade (audit isn't FK'd on project).
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'deleted',
        entity: {
          type: 'project',
          id: projectId,
          before: {
            code: project.code,
            name: project.name,
            clientId: project.clientId,
            stage: project.stage,
          },
          after: null,
        },
        source: 'web',
      });
      // Team / milestones / risks cascade via schema.
      await tx.project.delete({ where: { id: projectId } });
    });
  } catch (err) {
    console.error('[project.delete] failed:', err);
    return { status: 'error', message: 'Delete failed — try again.' };
  }

  revalidatePath('/projects');
  redirect('/projects?deleted=1');
}
