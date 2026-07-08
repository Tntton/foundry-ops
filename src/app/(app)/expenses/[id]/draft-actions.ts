'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import { resolveRequiredRole } from '@/server/approval-policies';
import { EXPENSE_CATEGORY_VALUES } from '@/lib/expense-categories';

export type DraftExpenseState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> }
  | { status: 'saved' }
  | { status: 'submitted' };

const DraftEdit = z
  .object({
    date: z.coerce.date(),
    amountDollars: z.coerce.number().min(0.01).max(100_000),
    gstDollars: z.coerce.number().min(0).max(100_000),
    category: z.enum(EXPENSE_CATEGORY_VALUES),
    vendor: z.string().trim().max(200).optional().or(z.literal('').transform(() => null)).nullable(),
    description: z.string().trim().max(1000).optional().or(z.literal('').transform(() => null)).nullable(),
    intent: z.enum(['save', 'submit']),
  })
  .refine((v) => v.gstDollars <= v.amountDollars, {
    message: 'GST cannot exceed total',
    path: ['gstDollars'],
  });

/**
 * Owner-edit for DRAFT expenses — the fix for OCR'd receipts that
 * landed with a wrong/zero amount (a failed extraction now creates a
 * draft; this is where the owner corrects it and pushes it into the
 * approval queue).
 *
 * intent='save'   → update fields, stay draft.
 * intent='submit' → update fields + flip to submitted + create the
 *                   Approval row + notify approvers (mirrors
 *                   /expenses/new's submit path).
 *
 * Only the expense owner (or super_admin/admin) can edit, and only
 * while status is 'draft' — everything else is immutable here.
 */
export async function saveDraftExpense(
  expenseId: string,
  _prev: DraftExpenseState,
  formData: FormData,
): Promise<DraftExpenseState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      personId: true,
      status: true,
      date: true,
      amount: true,
      gst: true,
      category: true,
      vendor: true,
      description: true,
    },
  });
  if (!expense) return { status: 'error', message: 'Expense not found' };

  const isOwner = expense.personId === session.person.id;
  if (!isOwner && !hasAnyRole(session, ['super_admin', 'admin'])) {
    return { status: 'error', message: 'Only the owner can edit this draft.' };
  }
  if (expense.status !== 'draft') {
    return {
      status: 'error',
      message: 'Only drafts are editable. This expense has already been submitted.',
    };
  }

  const parsed = DraftEdit.safeParse({
    date: formData.get('date'),
    amountDollars: formData.get('amountDollars'),
    gstDollars: formData.get('gstDollars'),
    category: formData.get('category'),
    vendor: formData.get('vendor') || null,
    description: formData.get('description') || null,
    intent: formData.get('intent'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }

  const data = parsed.data;
  const amountCents = Math.round(data.amountDollars * 100);
  const gstCents = Math.round(data.gstDollars * 100);
  const submitting = data.intent === 'submit';
  const requiredRole = submitting
    ? await resolveRequiredRole('expense', amountCents)
    : null;

  const before = {
    date: expense.date.toISOString().slice(0, 10),
    amount: expense.amount,
    gst: expense.gst,
    category: expense.category,
    vendor: expense.vendor,
    description: expense.description,
    status: expense.status,
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expenseId },
        data: {
          date: data.date,
          amount: amountCents,
          gst: gstCents,
          category: data.category,
          vendor: data.vendor ?? null,
          description: data.description ?? null,
          ...(submitting ? { status: 'submitted' } : {}),
        },
      });
      if (submitting && requiredRole) {
        const approval = await tx.approval.create({
          data: {
            subjectType: 'expense',
            subjectId: expenseId,
            // Attribution: the OWNER is the claimant even when an
            // admin fixes + submits on their behalf.
            requestedById: expense.personId,
            requiredRole,
            thresholdContext: {
              amount_cents: amountCents,
              threshold_cents: 200_000,
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
          summary: `${data.vendor ?? 'Expense'} · $${(amountCents / 100).toFixed(0)}`,
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
            vendor: data.vendor ?? null,
            description: data.description ?? null,
            status: submitting ? 'submitted' : 'draft',
            via: 'draft_edit',
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[expense.draftEdit] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/expenses/${expenseId}`);
  revalidatePath('/expenses');
  revalidatePath('/approvals');
  return submitting ? { status: 'submitted' } : { status: 'saved' };
}
