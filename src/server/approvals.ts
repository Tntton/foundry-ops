import type { ApprovalSubjectType, Role } from '@prisma/client';
import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';

/**
 * Decide required role for an expense approval.
 * MVP thresholds: >$2k inc GST → super_admin; otherwise → admin / manager (owning project).
 * TASK-049 will make these configurable via ApprovalPolicy rows.
 */
export function requiredRoleForExpense(amountCents: number): Role {
  return amountCents > 200_000 ? 'super_admin' : 'admin';
}

export function requiredRoleForInvoice(amountCents: number): Role {
  return amountCents > 2_000_000 ? 'super_admin' : 'partner';
}

export function requiredRoleForBill(): Role {
  return 'super_admin';
}

export type ApprovalQueueItem = {
  id: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  requiredRole: Role;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: { id: string; initials: string; firstName: string; lastName: string };
  createdAt: Date;
  thresholdContext: Record<string, unknown> | null;
  summary: string;
  amountCents: number | null;
};

export async function listPendingApprovals(session: Session): Promise<ApprovalQueueItem[]> {
  const roles = session.person.roles;

  const pending = await prisma.approval.findMany({
    where: {
      status: 'pending',
      requiredRole: { in: roles },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      requestedBy: { select: { id: true, initials: true, firstName: true, lastName: true } },
    },
  });

  // Hydrate subject details in parallel per type.
  const expenseIds = pending.filter((a) => a.subjectType === 'expense').map((a) => a.subjectId);
  const expenses = expenseIds.length
    ? await prisma.expense.findMany({
        where: { id: { in: expenseIds } },
        include: { project: { select: { code: true, name: true } } },
      })
    : [];
  const expenseById = new Map(expenses.map((e) => [e.id, e]));

  return pending.map<ApprovalQueueItem>((a) => {
    let summary = `${a.subjectType} · ${a.subjectId}`;
    let amountCents: number | null = null;
    if (a.subjectType === 'expense') {
      const e = expenseById.get(a.subjectId);
      if (e) {
        summary = `${e.category}${e.vendor ? ` · ${e.vendor}` : ''}${
          e.project ? ` · ${e.project.code}` : ' · OPEX'
        }`;
        amountCents = e.amount;
      }
    }
    return {
      id: a.id,
      subjectType: a.subjectType,
      subjectId: a.subjectId,
      requiredRole: a.requiredRole,
      status: a.status as 'pending' | 'approved' | 'rejected',
      requestedBy: a.requestedBy,
      createdAt: a.createdAt,
      thresholdContext:
        a.thresholdContext && typeof a.thresholdContext === 'object'
          ? (a.thresholdContext as Record<string, unknown>)
          : null,
      summary,
      amountCents,
    };
  });
}
