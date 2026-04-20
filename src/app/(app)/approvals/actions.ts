'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireSession } from '@/server/roles';
import { writeAudit } from '@/server/audit';

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
  if (!session.person.roles.includes(approval.requiredRole)) {
    return { status: 'error', message: 'Not authorized for this approval level' };
  }

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
      } else if (approval.subjectType === 'bill') {
        // Approved bills are ready for payment scheduling (TASK-100 ABA generator);
        // Rejected bills flip to BillStatus.rejected.
        const nextStatus = decision === 'approved' ? 'approved' : 'rejected';
        await tx.bill.update({
          where: { id: approval.subjectId },
          data: { status: nextStatus },
        });
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

  revalidatePath('/approvals');
  revalidatePath('/expenses');
  return { status: 'success' };
}
