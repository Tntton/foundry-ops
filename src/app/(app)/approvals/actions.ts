'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ApprovalSubjectType } from '@prisma/client';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { canActOnApproval, requireSession } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { emitUserUpdate } from '@/server/user-updates';
import type { UserUpdateKind } from '@prisma/client';
import { getXeroIntegration } from '@/server/integrations/xero';
import { pushInvoiceToXero } from '@/server/integrations/xero-invoices';
import { pushBillToXero } from '@/server/integrations/xero-bills';
import { generateContractorBillsFromInvoice } from '@/server/contractor-bills';
import { EXPENSE_CATEGORY_VALUES } from '@/lib/expense-categories';

const DecisionSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional().nullable(),
  // Admin-only allocation overrides at the approval gate. Together
  // these three pickers let admin re-tag project + associated user +
  // cost type in one approve action — the headline use-case is a
  // Navan-imported firm-paid travel bill whose trip name didn't
  // auto-tag a project, but the same controls cover any misfiled or
  // mis-categorised AP line.
  //
  // Empty string carries a specific meaning per field:
  //   - projectIdOverride: '' → unset to OPEX (no project)
  //   - attributedToPersonIdOverride: '' → un-pin (no one attributed)
  //   - categoryOverride: '' → keep current category (no-op)
  //
  // The server only patches each field when the picker actually
  // moved off the original value — null/undefined leaves the field
  // alone. categoryOverride is validated against the canonical
  // ExpenseCategory enum; the other two against the DB.
  projectIdOverride: z.string().nullable().optional(),
  attributedToPersonIdOverride: z.string().nullable().optional(),
  categoryOverride: z
    .union([z.enum(EXPENSE_CATEGORY_VALUES), z.literal('')])
    .nullable()
    .optional(),
});

export type DecisionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function decideApproval(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const session = await getSession();
  try {
    requireSession(session);
  } catch {
    return { status: 'error', message: 'Not signed in' };
  }

  const parsed = DecisionSchema.safeParse({
    approvalId: formData.get('approvalId'),
    decision: formData.get('decision'),
    note: formData.get('note') || null,
    projectIdOverride:
      formData.get('projectIdOverride') === null
        ? null
        : String(formData.get('projectIdOverride')),
    attributedToPersonIdOverride:
      formData.get('attributedToPersonIdOverride') === null
        ? null
        : String(formData.get('attributedToPersonIdOverride')),
    categoryOverride:
      formData.get('categoryOverride') === null
        ? null
        : String(formData.get('categoryOverride')),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };
  const {
    approvalId,
    decision,
    note,
    projectIdOverride,
    attributedToPersonIdOverride,
    categoryOverride,
  } = parsed.data;

  if (decision === 'rejected' && !note) {
    return { status: 'error', message: 'Decision note is required on reject.' };
  }

  const approval = await prisma.approval.findUnique({ where: { id: approvalId } });
  if (!approval) return { status: 'error', message: 'Approval not found' };
  if (approval.status !== 'pending') {
    return { status: 'error', message: 'Already decided' };
  }
  if (!canActOnApproval(session.person.roles, approval.requiredRole)) {
    return { status: 'error', message: 'Not authorized for this approval level' };
  }

  let pushInvoiceId: string | null = null;
  let pushBillId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.approval.update({
        where: { id: approvalId },
        data: {
          status: decision,
          decidedById: session.person.id,
          decidedAt: new Date(),
          decisionNote: note,
        },
      });

      // Helpers — translate the three override picker values into
      // Prisma update patches. All three only patch when the decision
      // is approved AND the picker actually moved off null/undefined
      // (= "don't touch this field"). The role gate is enforced inside
      // each helper so a non-admin formData injection can't slip
      // through.
      const isAdmin = session.person.roles.some((r) =>
        ['super_admin', 'admin'].includes(r),
      );
      const resolveProjectPatch = async (
        subjectLabel: 'expense' | 'bill',
      ): Promise<{ projectId: string | null } | undefined> => {
        if (
          decision !== 'approved' ||
          projectIdOverride === undefined ||
          projectIdOverride === null
        ) {
          return undefined;
        }
        if (!isAdmin) {
          throw new Error(
            'Only admin can override the project at the approval gate.',
          );
        }
        if (projectIdOverride === '') return { projectId: null };
        const proj = await tx.project.findUnique({
          where: { id: projectIdOverride },
          select: { id: true, code: true, stage: true },
        });
        if (!proj) throw new Error('Override project not found.');
        if (proj.stage === 'archived') {
          throw new Error(
            `Cannot route ${subjectLabel === 'expense' ? 'an expense' : 'a bill'} to an archived project.`,
          );
        }
        return { projectId: proj.id };
      };
      const resolveCategoryPatch = async (): Promise<
        { category: string } | undefined
      > => {
        if (
          decision !== 'approved' ||
          categoryOverride === undefined ||
          categoryOverride === null ||
          categoryOverride === ''
        ) {
          return undefined;
        }
        if (!isAdmin) {
          throw new Error(
            'Only admin can override the cost type at the approval gate.',
          );
        }
        // Already enum-validated by Zod — this cast is safe.
        return { category: categoryOverride };
      };
      const resolveAttributedToPatch = async (): Promise<
        { attributedToPersonId: string | null } | undefined
      > => {
        if (
          decision !== 'approved' ||
          attributedToPersonIdOverride === undefined ||
          attributedToPersonIdOverride === null
        ) {
          return undefined;
        }
        if (!isAdmin) {
          throw new Error(
            'Only admin can re-attribute a cost at the approval gate.',
          );
        }
        if (attributedToPersonIdOverride === '') {
          return { attributedToPersonId: null };
        }
        const person = await tx.person.findUnique({
          where: { id: attributedToPersonIdOverride },
          select: { id: true, inactiveAt: true },
        });
        if (!person) throw new Error('Attributed-user not found.');
        if (person.inactiveAt) {
          throw new Error(
            'Cannot attribute a cost to an inactive team member.',
          );
        }
        return { attributedToPersonId: person.id };
      };

      // Propagate the decision to the subject.
      if (approval.subjectType === 'expense') {
        const nextStatus = decision === 'approved' ? 'approved' : 'rejected';
        // Admin-only overrides: re-tag project / re-classify cost
        // type at the approval gate. Attributed-user is bills-only
        // (an expense's submitter IS the cost-recipient by
        // definition). Skipped on rejection so the original
        // allocation stays intact for re-submission.
        const projectIdPatch = await resolveProjectPatch('expense');
        const categoryPatch = await resolveCategoryPatch();
        await tx.expense.update({
          where: { id: approval.subjectId },
          data: {
            status: nextStatus,
            approvedById: decision === 'approved' ? session.person.id : null,
            approvedAt: decision === 'approved' ? new Date() : null,
            ...(projectIdPatch ?? {}),
            ...(categoryPatch ?? {}),
          },
        });
      } else if (approval.subjectType === 'invoice') {
        // Approved invoices move to 'approved' (ready to send via Xero — TASK-053);
        // Rejected invoices bounce back to 'draft' for edit.
        const nextStatus = decision === 'approved' ? 'approved' : 'draft';
        await tx.invoice.update({
          where: { id: approval.subjectId },
          data: { status: nextStatus },
        });
        if (decision === 'approved') pushInvoiceId = approval.subjectId;
      } else if (approval.subjectType === 'bill') {
        // Approved bills are ready for payment scheduling (TASK-100 ABA generator);
        // Rejected bills flip to BillStatus.rejected.
        const nextStatus = decision === 'approved' ? 'approved' : 'rejected';
        // Three admin-only overrides land here:
        //   - project: critical path for Navan-imported firm-paid
        //     bills whose trip name didn't auto-match a project code
        //   - cost type: drives the Xero GL account on push
        //   - attributed-to person: re-pin the cost recipient (e.g.
        //     a Navan booking made by an EA on behalf of a partner)
        // All three are skipped on rejection so the original
        // allocation stays intact for re-submission.
        const billProjectIdPatch = await resolveProjectPatch('bill');
        const billCategoryPatch = await resolveCategoryPatch();
        const billAttributedToPatch = await resolveAttributedToPatch();
        await tx.bill.update({
          where: { id: approval.subjectId },
          data: {
            status: nextStatus,
            ...(billProjectIdPatch ?? {}),
            ...(billCategoryPatch ?? {}),
            ...(billAttributedToPatch ?? {}),
          },
        });
        if (decision === 'approved') pushBillId = approval.subjectId;
      }
      // pay_run / contract / new_hire / rate_change propagation lands when those flows ship.

      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: decision,
        entity: {
          type: 'approval',
          id: approvalId,
          after: {
            subjectType: approval.subjectType,
            subjectId: approval.subjectId,
            decision,
            note: note ?? null,
            ...((approval.subjectType === 'expense' ||
              approval.subjectType === 'bill') &&
            decision === 'approved' &&
            projectIdOverride !== undefined &&
            projectIdOverride !== null
              ? {
                  projectIdOverride:
                    projectIdOverride === '' ? null : projectIdOverride,
                }
              : {}),
            // Cost-type / attributed-user overrides only fire on
            // expense+bill subjects, only on approve, only when the
            // picker actually moved off the original. Log the new
            // value so the audit trail captures what the admin chose.
            ...((approval.subjectType === 'expense' ||
              approval.subjectType === 'bill') &&
            decision === 'approved' &&
            categoryOverride !== undefined &&
            categoryOverride !== null &&
            categoryOverride !== ''
              ? { categoryOverride }
              : {}),
            ...(approval.subjectType === 'bill' &&
            decision === 'approved' &&
            attributedToPersonIdOverride !== undefined &&
            attributedToPersonIdOverride !== null
              ? {
                  attributedToPersonIdOverride:
                    attributedToPersonIdOverride === ''
                      ? null
                      : attributedToPersonIdOverride,
                }
              : {}),
          },
        },
        source: 'web',
      });

      // Notify the requester. Skip the self-approve case (rare: admin
      // approving their own submission) — they'd see their own action
      // bounce back which is just noise.
      if (approval.requestedById !== session.person.id) {
        const subjectLabel =
          approval.subjectType === 'expense'
            ? 'expense'
            : approval.subjectType === 'invoice'
              ? 'invoice'
              : approval.subjectType === 'bill'
                ? 'bill'
                : approval.subjectType.replace(/_/g, ' ');
        const verb = decision === 'approved' ? 'approved' : 'rejected';
        const kind: UserUpdateKind = (() => {
          if (approval.subjectType === 'expense') {
            return decision === 'approved'
              ? ('expense_approved' as const)
              : ('expense_rejected' as const);
          }
          // Invoice / bill / pay_run decisions don't have a dedicated
          // enum kind today — fall through to generic. The title still
          // tells the user exactly what happened.
          return 'generic' as const;
        })();
        const href =
          approval.subjectType === 'expense'
            ? `/expenses/${approval.subjectId}`
            : approval.subjectType === 'invoice'
              ? `/invoices/${approval.subjectId}`
              : approval.subjectType === 'bill'
                ? `/bills/${approval.subjectId}`
                : null;
        await emitUserUpdate(tx, {
          personId: approval.requestedById,
          kind,
          title: `Your ${subjectLabel} was ${verb}`,
          body: note ?? null,
          href,
          entityType: approval.subjectType,
          entityId: approval.subjectId,
        });
      }
    });
  } catch (err) {
    console.error('[approvals.decide] failed:', err);
    return { status: 'error', message: 'Decision failed — try again.' };
  }

  // Auto-generate contractor bills from approved invoices. Best-effort —
  // failures are logged but don't roll back the approval. The bills land in
  // BillStatus.pending_review so they pass through normal AP review before
  // being added to a pay run.
  if (pushInvoiceId) {
    try {
      const result = await generateContractorBillsFromInvoice(
        pushInvoiceId,
        session.person.id,
      );
      if (result.createdBillIds.length > 0) {
        console.info(
          `[approvals.decide] auto-generated ${result.createdBillIds.length} contractor bills from invoice ${pushInvoiceId}`,
        );
      }
    } catch (err) {
      console.error('[approvals.decide] contractor-bill generation failed:', err);
    }
  }

  // Best-effort Xero push after the approval commits. If Xero is down or the
  // push fails, the subject stays 'approved' locally and the detail-page
  // retry button picks up the slack.
  if (pushInvoiceId || pushBillId) {
    const xeroRow = await getXeroIntegration();
    if (xeroRow?.status === 'connected') {
      if (pushInvoiceId) {
        try {
          const xeroInvoiceId = await pushInvoiceToXero(pushInvoiceId);
          await prisma.$transaction(async (tx) => {
            await writeAudit(tx, {
              actor: { type: 'person', id: session.person.id },
              action: 'xero_pushed',
              entity: {
                type: 'invoice',
                id: pushInvoiceId!,
                after: { xeroInvoiceId },
              },
              source: 'web',
            });
          });
        } catch (err) {
          console.error('[approvals.decide] Xero invoice push failed:', err);
        }
      }
      if (pushBillId) {
        try {
          const xeroBillId = await pushBillToXero(pushBillId);
          await prisma.$transaction(async (tx) => {
            await writeAudit(tx, {
              actor: { type: 'person', id: session.person.id },
              action: 'xero_pushed',
              entity: {
                type: 'bill',
                id: pushBillId!,
                after: { xeroBillId },
              },
              source: 'web',
            });
          });
        } catch (err) {
          console.error('[approvals.decide] Xero bill push failed:', err);
        }
      }
    }
  }

  revalidatePath('/approvals');
  revalidatePath('/expenses');
  revalidatePath('/invoices');
  revalidatePath('/bills');
  if (pushInvoiceId) revalidatePath(`/invoices/${pushInvoiceId}`);
  if (pushBillId) revalidatePath(`/bills/${pushBillId}`);

  // Revalidate the owning project's detail page so its Bills / Invoices /
  // Expenses tab + P&L sidebar reflect the new status without manual reload.
  await revalidateProjectForSubject(approval.subjectType, approval.subjectId);

  return { status: 'success' };
}

async function revalidateProjectForSubject(
  subjectType: ApprovalSubjectType,
  subjectId: string,
): Promise<void> {
  try {
    let code: string | null = null;
    if (subjectType === 'bill') {
      const row = await prisma.bill.findUnique({
        where: { id: subjectId },
        select: { project: { select: { code: true } } },
      });
      code = row?.project?.code ?? null;
    } else if (subjectType === 'invoice') {
      const row = await prisma.invoice.findUnique({
        where: { id: subjectId },
        select: { project: { select: { code: true } } },
      });
      code = row?.project?.code ?? null;
    } else if (subjectType === 'expense') {
      const row = await prisma.expense.findUnique({
        where: { id: subjectId },
        select: { project: { select: { code: true } } },
      });
      code = row?.project?.code ?? null;
    }
    if (code) revalidatePath(`/projects/${code}`);
  } catch (err) {
    console.error('[approvals.decide] project revalidation lookup failed:', err);
  }
}

export type QuickAllocateState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

const QuickAllocateSchema = z.object({
  projectId: z.string().nullable().optional(),
  attributedToPersonId: z.string().nullable().optional(),
});

/**
 * Inline-queue allocator — admin can re-tag project + cost-attributed
 * user directly on a pending bill row in /approvals, without
 * expanding the Approve form. Auto-saves on each picker change.
 *
 * Bound by approvalId so the audit trail captures the queue row
 * context, but the underlying patch is on the Bill row. Same guard
 * rails as the bill-detail-page action (archived project / inactive
 * person rejected, admin-only via `bill.approve` capability).
 *
 * Used only for `subjectType === 'bill'`. Expense submitter is the
 * cost recipient by definition and re-pointing it would break the
 * reimbursement audit trail, so we don't expose the user picker for
 * expenses (the project picker on expense rows still uses the
 * approve-gate override path).
 */
export async function quickAllocateBillFromQueue(
  approvalId: string,
  _prev: QuickAllocateState,
  formData: FormData,
): Promise<QuickAllocateState> {
  const session = await getSession();
  try {
    requireSession(session);
  } catch {
    return { status: 'error', message: 'Not signed in' };
  }
  if (
    !session!.person.roles.some((r) => ['super_admin', 'admin'].includes(r))
  ) {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = QuickAllocateSchema.safeParse({
    projectId:
      formData.get('projectId') === null
        ? null
        : String(formData.get('projectId')),
    attributedToPersonId:
      formData.get('attributedToPersonId') === null
        ? null
        : String(formData.get('attributedToPersonId')),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };
  const { projectId, attributedToPersonId } = parsed.data;

  const approval = await prisma.approval.findUnique({
    where: { id: approvalId },
    select: { id: true, subjectType: true, subjectId: true, status: true },
  });
  if (!approval) return { status: 'error', message: 'Approval not found' };
  if (approval.subjectType !== 'bill') {
    return {
      status: 'error',
      message: 'Inline allocator only supports bill rows.',
    };
  }
  if (approval.status !== 'pending') {
    return { status: 'error', message: 'Already decided — open the bill page.' };
  }
  const bill = await prisma.bill.findUnique({
    where: { id: approval.subjectId },
    select: { id: true, projectId: true, attributedToPersonId: true },
  });
  if (!bill) return { status: 'error', message: 'Bill not found' };

  // Diff against the DB so we only patch + audit the fields that
  // actually moved. Empty string → null per the existing convention.
  const patch: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (projectId !== undefined && projectId !== null) {
    const next = projectId === '' ? null : projectId;
    if (next !== bill.projectId) {
      if (next !== null) {
        const proj = await prisma.project.findUnique({
          where: { id: next },
          select: { id: true, stage: true },
        });
        if (!proj) return { status: 'error', message: 'Project not found.' };
        if (proj.stage === 'archived') {
          return {
            status: 'error',
            message: 'Cannot route a bill to an archived project.',
          };
        }
      }
      patch.projectId = next;
      before.projectId = bill.projectId;
      after.projectId = next;
    }
  }

  if (attributedToPersonId !== undefined && attributedToPersonId !== null) {
    const next = attributedToPersonId === '' ? null : attributedToPersonId;
    if (next !== bill.attributedToPersonId) {
      if (next !== null) {
        const person = await prisma.person.findUnique({
          where: { id: next },
          select: { id: true, inactiveAt: true },
        });
        if (!person) return { status: 'error', message: 'Person not found.' };
        if (person.inactiveAt) {
          return {
            status: 'error',
            message: 'Cannot attribute a cost to an inactive team member.',
          };
        }
      }
      patch.attributedToPersonId = next;
      before.attributedToPersonId = bill.attributedToPersonId;
      after.attributedToPersonId = next;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { status: 'success', message: 'No changes.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.bill.update({ where: { id: bill.id }, data: patch });
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'classification_updated',
        entity: {
          type: 'bill',
          id: bill.id,
          before,
          after,
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[approvals.quickAllocate] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/approvals');
  revalidatePath(`/bills/${bill.id}`);
  return { status: 'success', message: 'Saved' };
}

export type BulkDecisionState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      applied?: number;
      failed?: number;
      skipped?: number;
    }
  | {
      status: 'success';
      applied: number;
      skipped: number;
      failed: number;
    };

const BulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Batch-apply a decision to multiple approvals. Runs each one serially (to
 * keep transaction boundaries clean) and ignores rows that have already been
 * decided or that the viewer isn't authorised for. Xero pushes for approved
 * invoices/bills fire best-effort in parallel after the DB commits.
 */
export async function decideApprovalBulk(
  _prev: BulkDecisionState,
  formData: FormData,
): Promise<BulkDecisionState> {
  const session = await getSession();
  try {
    requireSession(session);
  } catch {
    return { status: 'error', message: 'Not signed in' };
  }

  const rawIds = formData.getAll('approvalId').map(String);
  const rawDecision = formData.get('decision');
  const rawNote = formData.get('note');

  const parsed = BulkSchema.safeParse({
    ids: rawIds,
    decision: rawDecision,
    note: rawNote || null,
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid input — pick at least one row.' };
  }
  const { ids, decision, note } = parsed.data;

  if (decision === 'rejected' && !note) {
    return {
      status: 'error',
      message: 'A decision note is required when bulk-rejecting.',
    };
  }

  const approvals = await prisma.approval.findMany({
    where: { id: { in: ids } },
  });

  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const pushInvoiceIds: string[] = [];
  const pushBillIds: string[] = [];

  // Pre-flight: bulk-approve refuses to push unallocated bills / expenses
  // through (= subjectType ∈ {bill, expense} AND projectId is null). The
  // bulk strip has no per-row project picker; an admin must open the row
  // individually to allocate. This is the safety net behind the
  // "needs project allocation" amber chip shown in the queue.
  const unallocatedBillIds = new Set<string>();
  const unallocatedExpenseIds = new Set<string>();
  if (decision === 'approved') {
    const billIds = approvals
      .filter((a) => a.subjectType === 'bill')
      .map((a) => a.subjectId);
    const expenseIds = approvals
      .filter((a) => a.subjectType === 'expense')
      .map((a) => a.subjectId);
    const [bills, expenses] = await Promise.all([
      billIds.length === 0
        ? Promise.resolve([])
        : prisma.bill.findMany({
            where: { id: { in: billIds } },
            select: { id: true, projectId: true },
          }),
      expenseIds.length === 0
        ? Promise.resolve([])
        : prisma.expense.findMany({
            where: { id: { in: expenseIds } },
            select: { id: true, projectId: true },
          }),
    ]);
    for (const b of bills) if (!b.projectId) unallocatedBillIds.add(b.id);
    for (const e of expenses) if (!e.projectId) unallocatedExpenseIds.add(e.id);
  }

  for (const approval of approvals) {
    if (approval.status !== 'pending') {
      skipped += 1;
      continue;
    }
    if (!canActOnApproval(session.person.roles, approval.requiredRole)) {
      skipped += 1;
      continue;
    }
    if (
      decision === 'approved' &&
      ((approval.subjectType === 'bill' &&
        unallocatedBillIds.has(approval.subjectId)) ||
        (approval.subjectType === 'expense' &&
          unallocatedExpenseIds.has(approval.subjectId)))
    ) {
      skipped += 1;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.approval.update({
          where: { id: approval.id },
          data: {
            status: decision,
            decidedById: session.person.id,
            decidedAt: new Date(),
            decisionNote: note,
          },
        });

        const subjectType: ApprovalSubjectType = approval.subjectType;
        if (subjectType === 'expense') {
          const nextStatus = decision === 'approved' ? 'approved' : 'rejected';
          await tx.expense.update({
            where: { id: approval.subjectId },
            data: {
              status: nextStatus,
              approvedById: decision === 'approved' ? session.person.id : null,
              approvedAt: decision === 'approved' ? new Date() : null,
            },
          });
        } else if (subjectType === 'invoice') {
          const nextStatus = decision === 'approved' ? 'approved' : 'draft';
          await tx.invoice.update({
            where: { id: approval.subjectId },
            data: { status: nextStatus },
          });
          if (decision === 'approved') pushInvoiceIds.push(approval.subjectId);
        } else if (subjectType === 'bill') {
          const nextStatus = decision === 'approved' ? 'approved' : 'rejected';
          await tx.bill.update({
            where: { id: approval.subjectId },
            data: { status: nextStatus },
          });
          if (decision === 'approved') pushBillIds.push(approval.subjectId);
        }

        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: decision,
          entity: {
            type: 'approval',
            id: approval.id,
            after: {
              subjectType: approval.subjectType,
              subjectId: approval.subjectId,
              decision,
              note: note ?? null,
              via: 'bulk',
            },
          },
          source: 'web',
        });

        // Per-requester feed entry — same logic as the single-decide
        // path. Skip self-decisions.
        if (approval.requestedById !== session.person.id) {
          const subjectLabel =
            approval.subjectType === 'expense'
              ? 'expense'
              : approval.subjectType === 'invoice'
                ? 'invoice'
                : approval.subjectType === 'bill'
                  ? 'bill'
                  : approval.subjectType.replace(/_/g, ' ');
          const verb = decision === 'approved' ? 'approved' : 'rejected';
          const kind: UserUpdateKind =
            approval.subjectType === 'expense'
              ? decision === 'approved'
                ? 'expense_approved'
                : 'expense_rejected'
              : 'generic';
          const href =
            approval.subjectType === 'expense'
              ? `/expenses/${approval.subjectId}`
              : approval.subjectType === 'invoice'
                ? `/invoices/${approval.subjectId}`
                : approval.subjectType === 'bill'
                  ? `/bills/${approval.subjectId}`
                  : null;
          await emitUserUpdate(tx, {
            personId: approval.requestedById,
            kind,
            title: `Your ${subjectLabel} was ${verb}`,
            body: note ?? null,
            href,
            entityType: approval.subjectType,
            entityId: approval.subjectId,
          });
        }
      });
      applied += 1;
    } catch (err) {
      console.error('[approvals.decideBulk] item failed:', approval.id, err);
      failed += 1;
    }
  }

  // Auto-generate contractor bills for each approved invoice. Best-effort —
  // failures are logged per-invoice but don't roll back the approvals.
  for (const invId of pushInvoiceIds) {
    try {
      const result = await generateContractorBillsFromInvoice(invId, session.person.id);
      if (result.createdBillIds.length > 0) {
        console.info(
          `[approvals.decideBulk] auto-generated ${result.createdBillIds.length} contractor bills from invoice ${invId}`,
        );
      }
    } catch (err) {
      console.error('[approvals.decideBulk] contractor-bill generation failed:', invId, err);
    }
  }

  // Best-effort Xero pushes in parallel. Failures don't roll back.
  if (pushInvoiceIds.length > 0 || pushBillIds.length > 0) {
    const xeroRow = await getXeroIntegration();
    if (xeroRow?.status === 'connected') {
      await Promise.allSettled([
        ...pushInvoiceIds.map(async (id) => {
          try {
            const xeroInvoiceId = await pushInvoiceToXero(id);
            await prisma.$transaction(async (tx) => {
              await writeAudit(tx, {
                actor: { type: 'person', id: session.person.id },
                action: 'xero_pushed',
                entity: { type: 'invoice', id, after: { xeroInvoiceId } },
                source: 'web',
              });
            });
          } catch (err) {
            console.error('[approvals.decideBulk] invoice push failed:', id, err);
          }
        }),
        ...pushBillIds.map(async (id) => {
          try {
            const xeroBillId = await pushBillToXero(id);
            await prisma.$transaction(async (tx) => {
              await writeAudit(tx, {
                actor: { type: 'person', id: session.person.id },
                action: 'xero_pushed',
                entity: { type: 'bill', id, after: { xeroBillId } },
                source: 'web',
              });
            });
          } catch (err) {
            console.error('[approvals.decideBulk] bill push failed:', id, err);
          }
        }),
      ]);
    }
  }

  revalidatePath('/approvals');
  revalidatePath('/expenses');
  revalidatePath('/invoices');
  revalidatePath('/bills');

  // Refresh project pages for every subject we touched so their tabs reflect
  // the new statuses. Best-effort, deduped on project code.
  const touchedSubjects = approvals
    .filter((a) => a.status === 'pending')
    .filter((a) => canActOnApproval(session.person.roles, a.requiredRole))
    .map((a) => ({ subjectType: a.subjectType, subjectId: a.subjectId }));
  await Promise.all(
    touchedSubjects.map((s) => revalidateProjectForSubject(s.subjectType, s.subjectId)),
  );

  if (applied === 0) {
    return {
      status: 'error',
      message:
        failed > 0
          ? `All ${failed} decisions failed — check server logs.`
          : 'Nothing applied — rows were already decided or out of your scope.',
      applied,
      failed,
      skipped,
    };
  }
  return { status: 'success', applied, skipped, failed };
}
