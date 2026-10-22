'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import { resolveRequiredRole } from '@/server/approval-policies';
import { expenseMutationGate } from '@/server/expenses';
import { EXPENSE_CATEGORY_VALUES } from '@/lib/expense-categories';
import { splitExternalRef, joinExternalRef } from '@/lib/expense-ref';

export type ExpenseEditState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> }
  | { status: 'saved' }
  | { status: 'submitted' }
  | { status: 'deleted' };

/**
 * TASK-516 — edit / delete an expense after it has been submitted.
 *
 * Replaces the draft-only `saveDraftExpense`. Deliberately ONE write path
 * rather than two: a second editor that didn't consult
 * `expenseMutationGate` would be a way around the contractor-bill stop,
 * which is the whole point of the gate.
 *
 * Policy (who may do what, in which state) lives in
 * `src/server/expenses.ts` and is pure. This file is the plumbing around
 * it: Zod in, gate, transaction, audit.
 */

const EditSchema = z
  .object({
    date: z.coerce.date(),
    amountDollars: z.coerce.number().min(0.01).max(100_000),
    gstDollars: z.coerce.number().min(0).max(100_000),
    category: z.enum(EXPENSE_CATEGORY_VALUES),
    // '' = OPEX (no project).
    projectId: z.string().trim().max(60),
    vendor: z.string().trim().max(200),
    description: z.string().trim().max(1000),
    intent: z.enum(['save', 'submit']),
    /** Required when the gate says this is an admin override. */
    reason: z.string().trim().max(500),
  })
  .refine((v) => v.gstDollars <= v.amountDollars, {
    message: 'GST cannot exceed total',
    path: ['gstDollars'],
  });

const DeleteSchema = z.object({
  reason: z.string().trim().max(500),
  /** Typed confirmation so a delete can't be a mis-click. */
  confirm: z.literal('DELETE'),
});

const EXPENSE_SELECT = {
  id: true,
  personId: true,
  status: true,
  projectId: true,
  date: true,
  amount: true,
  gst: true,
  category: true,
  vendor: true,
  description: true,
  rebillable: true,
  contractorBillId: true,
  rebilledOnInvoiceId: true,
  approvedById: true,
  approvedAt: true,
} as const;

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Update an expense's fields.
 *
 * intent='save'   → write the fields, leave the status alone.
 * intent='submit' → only valid from `draft`: write the fields, flip to
 *                   `submitted`, open the approval.
 *
 * When the gate returns `reopensApproval` (an admin amending a figure
 * that was already approved / reimbursed), the row goes BACK to
 * `submitted`, the approver is cleared, any decided approval is
 * superseded by a fresh pending one at the required role for the NEW
 * amount, and the approver pool is notified. A signed-off number is never
 * quietly replaced with a different one.
 */
export async function updateExpense(
  expenseId: string,
  _prev: ExpenseEditState,
  formData: FormData,
): Promise<ExpenseEditState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: EXPENSE_SELECT,
  });
  if (!expense) return { status: 'error', message: 'Expense not found' };

  const parsed = EditSchema.safeParse({
    date: formData.get('date'),
    amountDollars: formData.get('amountDollars'),
    gstDollars: formData.get('gstDollars'),
    category: formData.get('category'),
    projectId: formData.get('projectId') ?? '',
    vendor: formData.get('vendor') ?? '',
    description: formData.get('description') ?? '',
    intent: formData.get('intent'),
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }
  const data = parsed.data;

  const gate = expenseMutationGate(
    expense,
    {
      personId: session.person.id,
      isAdmin: hasCapability(session, 'expense.edit.any'),
    },
    { mutation: 'edit', overrideReason: data.reason },
  );
  if (!gate.allowed) {
    return {
      status: 'error',
      message: gate.message,
      ...(gate.code === 'needs_reason' ? { fieldErrors: { reason: 'Required' } } : {}),
    };
  }

  const submitting = data.intent === 'submit';
  if (submitting && expense.status !== 'draft') {
    return {
      status: 'error',
      message: 'This expense has already been submitted.',
    };
  }

  const amountCents = Math.round(data.amountDollars * 100);
  const gstCents = Math.round(data.gstDollars * 100);

  // Project: '' means OPEX. Changing project adopts the new project's
  // contract default for rebillable, matching `tagExpenseProject`.
  const nextProjectId = data.projectId === '' ? null : data.projectId;
  let nextRebillable: boolean | undefined;
  if (nextProjectId !== null) {
    const project = await prisma.project.findUnique({
      where: { id: nextProjectId },
      select: { id: true, stage: true, defaultExpensesRebillable: true },
    });
    if (!project) {
      return { status: 'error', message: 'Project not found', fieldErrors: { projectId: 'Unknown project' } };
    }
    if (project.stage === 'archived') {
      return {
        status: 'error',
        message: 'Cannot tag archived projects.',
        fieldErrors: { projectId: 'Archived' },
      };
    }
    if (expense.projectId !== nextProjectId) {
      nextRebillable = project.defaultExpensesRebillable;
    }
  } else if (expense.projectId !== null) {
    nextRebillable = false;
  }

  // Keep the sync dedupe key the human never sees (see lib/expense-ref).
  const { ref: externalRef } = splitExternalRef(expense.description);
  const nextDescription = joinExternalRef(externalRef, data.description);

  // Re-opening sends it back through the gate at the NEW amount — an
  // edit that crosses the $2k line must be re-approved at the higher
  // tier, not inherit the tier the smaller figure was approved at.
  const needsApproval = submitting || gate.reopensApproval;
  const requiredRole = needsApproval ? await resolveRequiredRole('expense', amountCents) : null;

  const before = {
    date: expense.date.toISOString().slice(0, 10),
    amount: expense.amount,
    gst: expense.gst,
    category: expense.category,
    vendor: expense.vendor,
    description: expense.description,
    projectId: expense.projectId,
    rebillable: expense.rebillable,
    status: expense.status,
    approvedById: expense.approvedById,
  };

  const nextStatus = submitting || gate.reopensApproval ? 'submitted' : expense.status;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expenseId },
        data: {
          date: data.date,
          amount: amountCents,
          gst: gstCents,
          category: data.category,
          vendor: data.vendor === '' ? null : data.vendor,
          description: nextDescription,
          projectId: nextProjectId,
          ...(nextRebillable !== undefined ? { rebillable: nextRebillable } : {}),
          ...(nextStatus !== expense.status ? { status: nextStatus } : {}),
          // Re-opening drops the old signature — it was given for a
          // figure that no longer exists on this row.
          ...(gate.reopensApproval ? { approvedById: null, approvedAt: null } : {}),
        },
      });

      if (gate.reopensApproval) {
        // Supersede anything still pending so the queue doesn't carry
        // two live approvals for one expense.
        await tx.approval.updateMany({
          where: { subjectType: 'expense', subjectId: expenseId, status: 'pending' },
          data: {
            status: 'rejected',
            decidedById: session.person.id,
            decidedAt: new Date(),
            decisionNote: `Superseded — expense amended by admin: ${data.reason}`,
          },
        });
      }

      if (needsApproval && requiredRole) {
        const approval = await tx.approval.create({
          data: {
            subjectType: 'expense',
            subjectId: expenseId,
            // The OWNER is the claimant even when an admin edits on
            // their behalf.
            requestedById: expense.personId,
            requiredRole,
            thresholdContext: {
              amount_cents: amountCents,
              threshold_cents: 200_000,
              ...(gate.reopensApproval
                ? { reopened_from: expense.status, reopened_by: session.person.id }
                : {}),
            },
            channel: 'web',
          },
          select: { id: true },
        });
        await notifyApproversOfNewApproval(tx, {
          approvalId: approval.id,
          subjectType: 'expense',
          subjectId: expenseId,
          requiredRole,
          requestedById: expense.personId,
          amountCents,
          summary: `${data.vendor || 'Expense'} · $${(amountCents / 100).toFixed(0)}${
            gate.reopensApproval ? ' (amended — re-approval)' : ''
          }`,
        });
      }

      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: submitting ? 'submitted' : 'updated',
        entity: {
          type: 'expense',
          id: expenseId,
          before,
          after: {
            date: data.date.toISOString().slice(0, 10),
            amount: amountCents,
            gst: gstCents,
            category: data.category,
            vendor: data.vendor === '' ? null : data.vendor,
            description: nextDescription,
            projectId: nextProjectId,
            ...(nextRebillable !== undefined ? { rebillable: nextRebillable } : {}),
            status: nextStatus,
            approvedById: gate.reopensApproval ? null : expense.approvedById,
            via: 'expense_edit',
            mode: gate.mode,
            ...(gate.mode === 'admin_override' ? { override_reason: data.reason } : {}),
            ...(gate.reopensApproval ? { approval_reopened: true } : {}),
            // Flagged, not blocked: the cost may already sit on a client
            // invoice, which the amended figure no longer matches.
            ...(expense.rebilledOnInvoiceId
              ? { warning_rebilled_on_invoice: expense.rebilledOnInvoiceId }
              : {}),
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[expense.update] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/expenses/${expenseId}`);
  revalidatePath('/expenses');
  revalidatePath('/approvals');
  return submitting ? { status: 'submitted' } : { status: 'saved' };
}

/**
 * Delete an expense.
 *
 * A hard delete, because the alternative — a soft-deleted row the pay run
 * and the rebillable tallies would both have to learn to skip — is a
 * bigger change than this task, and the `AuditEvent` written in the same
 * transaction keeps the full before-image. Nothing is lost that the audit
 * log doesn't still hold.
 *
 * Same gate as the edit, so the contractor-bill stop applies identically:
 * a cost already invoiced to Foundry by a contractor cannot be deleted
 * out from under the bill.
 */
export async function deleteExpense(
  expenseId: string,
  _prev: ExpenseEditState,
  formData: FormData,
): Promise<ExpenseEditState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: EXPENSE_SELECT,
  });
  if (!expense) return { status: 'error', message: 'Expense not found' };

  const parsed = DeleteSchema.safeParse({
    reason: formData.get('reason') ?? '',
    confirm: formData.get('confirm') ?? '',
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Type DELETE to confirm.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const gate = expenseMutationGate(
    expense,
    {
      personId: session.person.id,
      isAdmin: hasCapability(session, 'expense.delete.any'),
    },
    { mutation: 'delete', overrideReason: parsed.data.reason },
  );
  if (!gate.allowed) {
    return {
      status: 'error',
      message: gate.message,
      ...(gate.code === 'needs_reason' ? { fieldErrors: { reason: 'Required' } } : {}),
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Cancel any approval still waiting on a decision — otherwise the
      // queue holds a row pointing at an expense that no longer exists.
      await tx.approval.updateMany({
        where: { subjectType: 'expense', subjectId: expenseId, status: 'pending' },
        data: {
          status: 'rejected',
          decidedById: session.person.id,
          decidedAt: new Date(),
          decisionNote:
            gate.mode === 'admin_override'
              ? `Expense deleted by admin: ${parsed.data.reason}`
              : 'Expense withdrawn by the submitter',
        },
      });
      await tx.expense.delete({ where: { id: expenseId } });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'deleted',
        entity: {
          type: 'expense',
          id: expenseId,
          // Full before-image: this row is the only remaining record.
          before: {
            personId: expense.personId,
            date: expense.date.toISOString().slice(0, 10),
            amount: expense.amount,
            gst: expense.gst,
            category: expense.category,
            vendor: expense.vendor,
            description: expense.description,
            projectId: expense.projectId,
            rebillable: expense.rebillable,
            rebilledOnInvoiceId: expense.rebilledOnInvoiceId,
            status: expense.status,
            approvedById: expense.approvedById,
          },
          after: null,
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[expense.delete] failed:', err);
    return { status: 'error', message: 'Delete failed — try again.' };
  }

  revalidatePath('/expenses');
  revalidatePath('/approvals');
  return { status: 'deleted' };
}
