'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { writeAudit } from '@/server/audit';

export type ChecklistActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

async function requireProjectAccess(projectId: string) {
  const session = await getSession();
  if (!session) throw new Error('unauth');
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, managerId: true, primaryPartnerId: true },
  });
  if (!project) throw new Error('not-found');
  const roles = session.person.roles;
  const canAll = roles.some((r) => ['super_admin', 'admin', 'partner'].includes(r));
  if (
    !canAll &&
    project.managerId !== session.person.id &&
    project.primaryPartnerId !== session.person.id
  ) {
    throw new Error('forbidden');
  }
  return { session, project };
}

const CreateListSchema = z.object({
  label: z.string().trim().min(1).max(160),
});

export async function createChecklist(
  projectId: string,
  _prev: ChecklistActionState,
  formData: FormData,
): Promise<ChecklistActionState> {
  try {
    const { session, project } = await requireProjectAccess(projectId);
    const parsed = CreateListSchema.safeParse({ label: formData.get('label') });
    if (!parsed.success) return { status: 'error', message: 'Label is required' };

    const order = await prisma.projectChecklist.count({ where: { projectId } });

    await prisma.$transaction(async (tx) => {
      const list = await tx.projectChecklist.create({
        data: { projectId, label: parsed.data.label, order },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'project_checklist',
          id: list.id,
          after: { projectId, label: list.label },
        },
        source: 'web',
      });
    });

    revalidatePath(`/projects/${project.code}`);
    return { status: 'success', message: 'Checklist added.' };
  } catch (err) {
    return mapError(err);
  }
}

export async function deleteChecklist(
  projectId: string,
  checklistId: string,
  _prev: ChecklistActionState,
): Promise<ChecklistActionState> {
  try {
    const { session, project } = await requireProjectAccess(projectId);
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'deleted',
        entity: { type: 'project_checklist', id: checklistId, before: { projectId } },
        source: 'web',
      });
      await tx.projectChecklist.delete({ where: { id: checklistId } });
    });
    revalidatePath(`/projects/${project.code}`);
    return { status: 'success', message: 'Checklist removed.' };
  } catch (err) {
    return mapError(err);
  }
}

const AddItemSchema = z.object({
  label: z.string().trim().min(1).max(240),
});

export async function addChecklistItem(
  projectId: string,
  checklistId: string,
  _prev: ChecklistActionState,
  formData: FormData,
): Promise<ChecklistActionState> {
  try {
    const { session, project } = await requireProjectAccess(projectId);
    const parsed = AddItemSchema.safeParse({ label: formData.get('label') });
    if (!parsed.success) return { status: 'error', message: 'Label is required' };

    const order = await prisma.projectChecklistItem.count({ where: { checklistId } });

    await prisma.$transaction(async (tx) => {
      const item = await tx.projectChecklistItem.create({
        data: { checklistId, label: parsed.data.label, order },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'project_checklist_item',
          id: item.id,
          after: { checklistId, label: item.label },
        },
        source: 'web',
      });
    });

    revalidatePath(`/projects/${project.code}`);
    return { status: 'success', message: 'Item added.' };
  } catch (err) {
    return mapError(err);
  }
}

export async function toggleChecklistItem(
  projectId: string,
  itemId: string,
  _prev: ChecklistActionState,
): Promise<ChecklistActionState> {
  try {
    const { session, project } = await requireProjectAccess(projectId);
    const item = await prisma.projectChecklistItem.findUnique({ where: { id: itemId } });
    if (!item) return { status: 'error', message: 'Item not found' };

    const nextDone = !item.done;
    await prisma.projectChecklistItem.update({
      where: { id: itemId },
      data: {
        done: nextDone,
        doneAt: nextDone ? new Date() : null,
        doneById: nextDone ? session.person.id : null,
      },
    });

    revalidatePath(`/projects/${project.code}`);
    return { status: 'success', message: nextDone ? 'Done.' : 'Reopened.' };
  } catch (err) {
    return mapError(err);
  }
}

const AssignItemSchema = z.object({
  // Empty string clears the assignee; any other value must be a person id.
  assigneeId: z.string(),
});

export async function assignChecklistItem(
  projectId: string,
  itemId: string,
  _prev: ChecklistActionState,
  formData: FormData,
): Promise<ChecklistActionState> {
  try {
    const { session, project } = await requireProjectAccess(projectId);
    const parsed = AssignItemSchema.safeParse({ assigneeId: formData.get('assigneeId') });
    if (!parsed.success) return { status: 'error', message: 'Invalid assignee' };

    const item = await prisma.projectChecklistItem.findUnique({
      where: { id: itemId },
      select: { id: true, checklistId: true, assigneeId: true, checklist: { select: { projectId: true } } },
    });
    if (!item || item.checklist.projectId !== projectId) {
      return { status: 'error', message: 'Item not found' };
    }

    const nextAssigneeId = parsed.data.assigneeId === '' ? null : parsed.data.assigneeId;
    if (nextAssigneeId) {
      // Only an active person can own an item — guards against a stale
      // option or a hand-crafted id.
      const person = await prisma.person.findFirst({
        where: { id: nextAssigneeId, endDate: null },
        select: { id: true },
      });
      if (!person) return { status: 'error', message: 'Unknown assignee' };
    }

    if (nextAssigneeId === item.assigneeId) {
      return { status: 'success', message: 'No change.' };
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.projectChecklistItem.update({
        where: { id: itemId },
        data: { assigneeId: nextAssigneeId },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'project_checklist_item',
          id: updated.id,
          before: { assigneeId: item.assigneeId },
          after: { assigneeId: updated.assigneeId },
        },
        source: 'web',
      });
    });

    revalidatePath(`/projects/${project.code}`);
    return { status: 'success', message: nextAssigneeId ? 'Assigned.' : 'Unassigned.' };
  } catch (err) {
    return mapError(err);
  }
}

export async function deleteChecklistItem(
  projectId: string,
  itemId: string,
  _prev: ChecklistActionState,
): Promise<ChecklistActionState> {
  try {
    const { project } = await requireProjectAccess(projectId);
    await prisma.projectChecklistItem.delete({ where: { id: itemId } });
    revalidatePath(`/projects/${project.code}`);
    return { status: 'success', message: 'Item removed.' };
  } catch (err) {
    return mapError(err);
  }
}

function mapError(err: unknown): ChecklistActionState {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  if (msg === 'unauth') return { status: 'error', message: 'Not authorized' };
  if (msg === 'not-found') return { status: 'error', message: 'Project not found' };
  if (msg === 'forbidden') return { status: 'error', message: 'Only project leadership can edit checklists' };
  console.error('[checklist] failed:', err);
  return { status: 'error', message: 'Action failed — try again.' };
}
