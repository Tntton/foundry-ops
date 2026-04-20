import type { ApprovalSubjectType, Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { approvalRoleFilter, type Session } from '@/server/roles';

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
      ...approvalRoleFilter(roles),
    },
    orderBy: { createdAt: 'asc' },
    include: {
      requestedBy: { select: { id: true, initials: true, firstName: true, lastName: true } },
    },
  });

  // Hydrate subject details per type.
  const expenseIds = pending.filter((a) => a.subjectType === 'expense').map((a) => a.subjectId);
  const invoiceIds = pending.filter((a) => a.subjectType === 'invoice').map((a) => a.subjectId);
  const billIds = pending.filter((a) => a.subjectType === 'bill').map((a) => a.subjectId);

  const [expenses, invoices, bills] = await Promise.all([
    expenseIds.length
      ? prisma.expense.findMany({
          where: { id: { in: expenseIds } },
          include: { project: { select: { code: true, name: true } } },
        })
      : Promise.resolve([]),
    invoiceIds.length
      ? prisma.invoice.findMany({
          where: { id: { in: invoiceIds } },
          include: {
            project: { select: { code: true, name: true } },
            client: { select: { code: true, legalName: true } },
          },
        })
      : Promise.resolve([]),
    billIds.length
      ? prisma.bill.findMany({
          where: { id: { in: billIds } },
          include: { project: { select: { code: true, name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const expenseById = new Map(expenses.map((e) => [e.id, e]));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const billById = new Map(bills.map((b) => [b.id, b]));

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
    } else if (a.subjectType === 'invoice') {
      const i = invoiceById.get(a.subjectId);
      if (i) {
        summary = `${i.number} · ${i.client.code} ${i.client.legalName} · ${i.project.code}`;
        amountCents = i.amountTotal;
      }
    } else if (a.subjectType === 'bill') {
      const b = billById.get(a.subjectId);
      if (b) {
        summary = `${b.supplierName}${b.supplierInvoiceNumber ? ` · ${b.supplierInvoiceNumber}` : ''}${
          b.project ? ` · ${b.project.code}` : ' · OPEX'
        } · ${b.category.replace(/_/g, ' ')}`;
        amountCents = b.amountTotal;
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

export type ApprovalsAnalytics = {
  pendingCount: number;
  oldestPendingAgeDays: number | null;
  pendingByType: Record<string, number>;
  decidedLast7: number;
  decidedLast30: number;
  avgCycleHoursLast30: number | null;
  approverBreakdownLast30: Array<{
    personId: string;
    initials: string;
    name: string;
    count: number;
  }>;
};

/**
 * Computes approval queue analytics scoped to whatever the viewer can see
 * (their roles). Cycle time is the delta between Approval.createdAt and
 * decidedAt, averaged over the last 30 days of decided rows.
 */
export async function getApprovalsAnalytics(session: Session): Promise<ApprovalsAnalytics> {
  const roles = session.person.roles;
  const now = Date.now();
  const d7 = new Date(now - 7 * 24 * 3600 * 1000);
  const d30 = new Date(now - 30 * 24 * 3600 * 1000);

  const roleFilter = approvalRoleFilter(roles);
  const [pending, recentDecided] = await Promise.all([
    prisma.approval.findMany({
      where: { status: 'pending', ...roleFilter },
      select: { subjectType: true, createdAt: true },
    }),
    prisma.approval.findMany({
      where: {
        status: { in: ['approved', 'rejected'] },
        decidedAt: { gte: d30 },
        ...roleFilter,
      },
      select: {
        createdAt: true,
        decidedAt: true,
        decidedBy: {
          select: { id: true, initials: true, firstName: true, lastName: true },
        },
      },
    }),
  ]);

  const pendingByType: Record<string, number> = {};
  let oldestCreated: Date | null = null;
  for (const p of pending) {
    pendingByType[p.subjectType] = (pendingByType[p.subjectType] ?? 0) + 1;
    if (!oldestCreated || p.createdAt < oldestCreated) oldestCreated = p.createdAt;
  }
  const oldestPendingAgeDays = oldestCreated
    ? Math.floor((now - oldestCreated.getTime()) / (24 * 3600 * 1000))
    : null;

  let decidedLast7 = 0;
  let cycleSumMs = 0;
  let cycleCount = 0;
  const approverTally = new Map<
    string,
    { initials: string; name: string; count: number }
  >();
  for (const d of recentDecided) {
    if (!d.decidedAt) continue;
    if (d.decidedAt >= d7) decidedLast7++;
    cycleSumMs += d.decidedAt.getTime() - d.createdAt.getTime();
    cycleCount++;
    if (d.decidedBy) {
      const key = d.decidedBy.id;
      const entry =
        approverTally.get(key) ??
        ({
          initials: d.decidedBy.initials,
          name: `${d.decidedBy.firstName} ${d.decidedBy.lastName}`,
          count: 0,
        } as { initials: string; name: string; count: number });
      entry.count += 1;
      approverTally.set(key, entry);
    }
  }

  const avgCycleHoursLast30 =
    cycleCount > 0 ? Math.round((cycleSumMs / cycleCount / 3600 / 1000) * 10) / 10 : null;

  const approverBreakdownLast30 = [...approverTally.entries()]
    .map(([personId, v]) => ({ personId, ...v }))
    .sort((a, b) => b.count - a.count);

  return {
    pendingCount: pending.length,
    oldestPendingAgeDays,
    pendingByType,
    decidedLast7,
    decidedLast30: recentDecided.length,
    avgCycleHoursLast30,
    approverBreakdownLast30,
  };
}
