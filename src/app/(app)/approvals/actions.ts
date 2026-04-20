'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { canActOnApproval, requireSession } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { getXeroIntegration } from '@/server/integrations/xero';
import { pushInvoiceToXero } from '@/server/integrations/xero-invoices';
import { pushBillToXero } from '@/server/integrations/xero-bills';

const DecisionSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional().nullable(),
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
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };
  const { approvalId, decision, note } = parsed.data;

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

      // Propagate the decision to the subject.
      if (approval.subjectType === 'expense') {
        const nextStatus = decision === 'approved' ? 'approved' : 'rejected';
        await tx.expense.update({
          where: { id: approval.subjectId },
          data: {
            status: nextStatus,
            approvedById: decision === 'approved' ? session.person.id : null,
            approvedAt: decision === 'approved' ? new Date() : null,
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
        await tx.bill.update({
          where: { id: approval.subjectId },
          data: { status: nextStatus },
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
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[approvals.decide] failed:', err);
    return { status: 'error', message: 'Decision failed — try again.' };
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
  return { status: 'success' };
}
