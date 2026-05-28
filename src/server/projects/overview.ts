import { prisma } from '@/server/db';

export type ProjectApprovalRow = {
  id: string; // approval row id
  subjectType: 'invoice' | 'expense' | 'bill';
  subjectId: string;
  amountCents: number;
  label: string;
  href: string;
  requiredRole: string;
  createdAt: Date;
  ageDays: number;
};

export type ProjectOverviewExtras = {
  pendingApprovals: ProjectApprovalRow[];
  recentActivity: Array<{
    id: string;
    action: string;
    actor: string | null;
    entityType: string;
    at: Date;
  }>;
  invoiceSummary: {
    draft: number;
    pending: number;
    approved: number;
    sent: number;
    paid: number;
    overdueCount: number;
    totalOpenCents: number;
  };
  expenseSummary: {
    submitted: number;
    approved: number;
    totalApprovedCents: number;
  };
  riskSummary: {
    open: number;
    high: number;
    medium: number;
    low: number;
  };
  checklistSummary: Array<{
    id: string;
    label: string;
    done: number;
    total: number;
    pct: number;
  }>;
};

/**
 * Pulls the bits the project overview shows alongside the core P&L /
 * timesheet / invoice data. Kept narrow so the overview page stays snappy
 * even on projects with thousands of audit rows.
 */
export async function computeProjectOverviewExtras(
  projectId: string,
): Promise<ProjectOverviewExtras> {
  const now = Date.now();
  // Sequential — see comments in pnl.ts / team-utilisation.ts. Supabase
  // session-mode pgbouncer caps total in-flight at 15; this helper alone
  // would have eaten 7 if parallelised.
  const invoices = await prisma.invoice.findMany({
    where: { projectId },
    select: {
      id: true,
      status: true,
      amountTotal: true,
      paymentReceivedAmount: true,
      dueDate: true,
    },
  });
  const expenses = await prisma.expense.findMany({
    where: { projectId },
    select: { id: true, status: true, amount: true, gst: true },
  });
  const bills = await prisma.bill.findMany({
    where: { projectId },
    select: { id: true, status: true, amountTotal: true },
  });
  const risks = await prisma.risk.findMany({
    where: { projectId, status: { in: ['open', 'mitigating'] } },
    select: { severity: true },
  });
  const checklists = await prisma.projectChecklist.findMany({
    where: { projectId },
    orderBy: { order: 'asc' },
    include: { items: { select: { done: true } } },
  });
  const approvals = await prisma.approval.findMany({
    where: {
      status: 'pending',
      OR: [
        { subjectType: 'invoice' },
        { subjectType: 'expense' },
        { subjectType: 'bill' },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      subjectType: true,
      subjectId: true,
      requiredRole: true,
      createdAt: true,
    },
  });
  const recentAudit = await prisma.auditEvent.findMany({
    where: {
      OR: [
        { entityType: 'project', entityId: projectId },
        { entityType: 'invoice', entityDelta: { path: ['after', 'projectId'], equals: projectId } },
      ],
    },
    orderBy: { at: 'desc' },
    take: 10,
    include: {
      actor: { select: { firstName: true, lastName: true, initials: true } },
    },
  });

  // Filter approvals to ones whose subject lives on this project.
  const invoiceIds = new Set(invoices.map((i) => i.id));
  const expenseIds = new Set(expenses.map((e) => e.id));
  const billIds = new Set(bills.map((b) => b.id));
  const projectApprovals: ProjectApprovalRow[] = [];
  const expenseAmounts = new Map(
    expenses.map((e) => [e.id, e.amount + e.gst] as const),
  );
  const invoiceAmounts = new Map(invoices.map((i) => [i.id, i.amountTotal] as const));
  const billAmounts = new Map(bills.map((b) => [b.id, b.amountTotal] as const));
  for (const a of approvals) {
    let amountCents = 0;
    let label = '';
    let href = '';
    if (a.subjectType === 'invoice' && invoiceIds.has(a.subjectId)) {
      amountCents = invoiceAmounts.get(a.subjectId) ?? 0;
      label = 'Invoice approval';
      href = `/invoices/${a.subjectId}`;
    } else if (a.subjectType === 'expense' && expenseIds.has(a.subjectId)) {
      amountCents = expenseAmounts.get(a.subjectId) ?? 0;
      label = 'Expense approval';
      href = `/expenses/${a.subjectId}`;
    } else if (a.subjectType === 'bill' && billIds.has(a.subjectId)) {
      amountCents = billAmounts.get(a.subjectId) ?? 0;
      label = 'Bill approval';
      href = `/bills/${a.subjectId}`;
    } else {
      continue;
    }
    projectApprovals.push({
      id: a.id,
      subjectType: a.subjectType as 'invoice' | 'expense' | 'bill',
      subjectId: a.subjectId,
      amountCents,
      label,
      href,
      requiredRole: a.requiredRole,
      createdAt: a.createdAt,
      ageDays: Math.floor((now - a.createdAt.getTime()) / 86_400_000),
    });
  }

  // Invoice + expense + risk roll-ups
  const invoiceSummary = {
    draft: 0,
    pending: 0,
    approved: 0,
    sent: 0,
    paid: 0,
    overdueCount: 0,
    totalOpenCents: 0,
  };
  for (const i of invoices) {
    if (i.status === 'draft') invoiceSummary.draft += 1;
    else if (i.status === 'pending_approval') invoiceSummary.pending += 1;
    else if (i.status === 'approved') invoiceSummary.approved += 1;
    else if (i.status === 'sent' || i.status === 'partial')
      invoiceSummary.sent += 1;
    else if (i.status === 'paid') invoiceSummary.paid += 1;
    if (
      ['approved', 'sent', 'partial', 'overdue'].includes(i.status) &&
      i.dueDate.getTime() < now
    ) {
      invoiceSummary.overdueCount += 1;
    }
    if (['approved', 'sent', 'partial', 'overdue'].includes(i.status)) {
      invoiceSummary.totalOpenCents +=
        i.amountTotal - (i.paymentReceivedAmount ?? 0);
    }
  }

  const expenseSummary = {
    submitted: 0,
    approved: 0,
    totalApprovedCents: 0,
  };
  for (const e of expenses) {
    if (e.status === 'submitted') expenseSummary.submitted += 1;
    if (
      e.status === 'approved' ||
      e.status === 'reimbursed' ||
      e.status === 'batched_for_payment'
    ) {
      expenseSummary.approved += 1;
      expenseSummary.totalApprovedCents += e.amount - e.gst;
    }
  }

  const riskSummary = {
    open: risks.length,
    high: risks.filter((r) => r.severity === 'high').length,
    medium: risks.filter((r) => r.severity === 'medium').length,
    low: risks.filter((r) => r.severity === 'low').length,
  };

  const checklistSummary = checklists.map((cl) => {
    const done = cl.items.filter((i) => i.done).length;
    const total = cl.items.length;
    return {
      id: cl.id,
      label: cl.label,
      done,
      total,
      pct: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  });

  return {
    pendingApprovals: projectApprovals,
    recentActivity: recentAudit.map((a) => ({
      id: a.id,
      action: a.action,
      actor: a.actor ? `${a.actor.firstName} ${a.actor.lastName}` : null,
      entityType: a.entityType,
      at: a.at,
    })),
    invoiceSummary,
    expenseSummary,
    riskSummary,
    checklistSummary,
  };
}
