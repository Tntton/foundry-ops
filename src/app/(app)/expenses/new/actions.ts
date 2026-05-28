'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import { resolveRequiredRole } from '@/server/approval-policies';
import { EXPENSE_CATEGORY_VALUES } from '@/lib/expense-categories';

// Bills + expenses both post into Xero as expense lines, so they share
// one canonical category list (see src/lib/expense-categories.ts) that
// matches the AU starter chart of accounts + ATO Income Tax Assessment
// Act 1997 deductibility splits.
const EXPENSE_CATEGORIES = EXPENSE_CATEGORY_VALUES;

const ExpenseCreate = z
  .object({
    projectId: z.string().optional().nullable(),
    date: z.coerce.date(),
    amountDollars: z.coerce.number().min(0.01).max(100_000),
    gstDollars: z.coerce.number().min(0).max(100_000),
    category: z.enum(EXPENSE_CATEGORIES),
    vendor: z.string().trim().max(200).optional().nullable(),
    description: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((v) => v.gstDollars <= v.amountDollars, {
    message: 'GST cannot exceed total',
    path: ['gstDollars'],
  });

export type NewExpenseState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function submitExpense(
  _prev: NewExpenseState,
  formData: FormData,
): Promise<NewExpenseState> {
  const session = await getSession();
  try {
    requireCapability(session, 'expense.submit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const raw = {
    projectId: formData.get('projectId') || null,
    date: formData.get('date'),
    amountDollars: formData.get('amountDollars'),
    gstDollars: formData.get('gstDollars'),
    category: formData.get('category'),
    vendor: formData.get('vendor') || null,
    description: formData.get('description') || null,
  };

  const parsed = ExpenseCreate.safeParse(raw);
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
  const requiredRole = await resolveRequiredRole('expense', amountCents);
  const projectId =
    data.projectId && data.projectId !== '' ? data.projectId : null;

  // If the expense is tagged to a project that defaults to pass-through
  // billing (T&M / cost-plus contracts), seed `rebillable=true` so the
  // line surfaces in the Payables / Reimbursables "rebillable" float
  // automatically. Reviewer can still untoggle per row.
  let rebillableDefault = false;
  if (projectId) {
    const proj = await prisma.project.findUnique({
      where: { id: projectId },
      select: { defaultExpensesRebillable: true },
    });
    rebillableDefault = proj?.defaultExpensesRebillable ?? false;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          personId: session.person.id,
          projectId,
          date: data.date,
          amount: amountCents,
          gst: gstCents,
          category: data.category,
          vendor: data.vendor,
          description: data.description,
          status: 'submitted',
          rebillable: rebillableDefault,
        },
      });
      const approval = await tx.approval.create({
        data: {
          subjectType: 'expense',
          subjectId: expense.id,
          requestedById: session.person.id,
          requiredRole,
          thresholdContext: {
            amount_cents: amountCents,
            threshold_cents: 200_000,
          },
          channel: 'web',
        },
        select: { id: true },
      });
      // Notify the approver pool so they don't have to refresh
      // /approvals to see new work landing.
      await notifyApproversOfNewApproval(tx, {
        approvalId: approval.id,
        subjectType: 'expense',
        subjectId: expense.id,
        requiredRole,
        requestedById: session.person.id,
        summary: `${data.vendor ?? 'Expense'} · $${(amountCents / 100).toFixed(0)}`,
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'submitted',
        entity: {
          type: 'expense',
          id: expense.id,
          after: {
            projectId: expense.projectId,
            amount: expense.amount,
            gst: expense.gst,
            category: expense.category,
            vendor: expense.vendor,
            status: expense.status,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[expense.submit] failed:', err);
    return { status: 'error', message: 'Submit failed — try again.' };
  }

  revalidatePath('/expenses');
  revalidatePath('/approvals');
  redirect('/expenses');
}
