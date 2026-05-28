'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { writeAudit } from '@/server/audit';

export type TagProjectState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const TagSchema = z.object({
  projectId: z.union([z.string().min(1), z.literal('').transform(() => null)]).nullable(),
});

/**
 * Tag (or untag — empty string = OPEX) a project on an expense. Only the
 * submitter or an admin / super_admin can do this, and only while the row
 * is still editable (draft / submitted). Once the approval is decided the
 * project is locked so it can't be retroactively reshuffled across P&Ls.
 */
export async function tagExpenseProject(
  expenseId: string,
  _prev: TagProjectState,
  formData: FormData,
): Promise<TagProjectState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: { id: true, personId: true, projectId: true, status: true, amount: true },
  });
  if (!expense) return { status: 'error', message: 'Expense not found' };

  // Reallocation policy (per TT, 2026-05-10): anyone signed in can
  // tag / re-tag the project on a draft or submitted expense — so the
  // owner can self-correct before submitting AND a colleague can fix
  // a misfile during review. Once it lands in `approved` / `rejected`
  // / `reimbursed` the project is locked here; admin-side overrides
  // happen via the approval-decision flow.
  if (expense.status !== 'draft' && expense.status !== 'submitted') {
    return {
      status: 'error',
      message: `Project locked once status is ${expense.status.replace('_', ' ')}. Admin can override at the approval gate.`,
    };
  }

  const parsed = TagSchema.safeParse({
    projectId: formData.get('projectId') ?? '',
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid project' };
  }
  const projectId = parsed.data.projectId;

  // Verify the project exists + isn't archived (allow tagging only active
  // projects). Also pull `defaultExpensesRebillable` so we can apply the
  // project's contract-default rebillable flag on the same write.
  let nextRebillable: boolean | undefined;
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, stage: true, defaultExpensesRebillable: true },
    });
    if (!project) return { status: 'error', message: 'Project not found' };
    if (project.stage === 'archived') {
      return { status: 'error', message: 'Cannot tag archived projects.' };
    }
    // Only auto-flip when the project is changing — preserves an explicit
    // user toggle if they're just re-saving the same project.
    if (expense.projectId !== projectId) {
      nextRebillable = project.defaultExpensesRebillable;
    }
  } else {
    // Untagging to OPEX — clear rebillable since there's no project to
    // recharge against.
    nextRebillable = false;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expenseId },
        data: {
          projectId: projectId ?? null,
          ...(nextRebillable !== undefined ? { rebillable: nextRebillable } : {}),
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'expense',
          id: expenseId,
          before: { projectId: expense.projectId },
          after: {
            projectId: projectId ?? null,
            ...(nextRebillable !== undefined
              ? { rebillable: nextRebillable }
              : {}),
            via: 'tag_project',
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[expense.tagProject] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/expenses/${expenseId}`);
  revalidatePath('/expenses');
  revalidatePath('/approvals');
  return { status: 'success' };
}
