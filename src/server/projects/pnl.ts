import { prisma } from '@/server/db';

export type ProjectPnL = {
  contractValue: number; // AUD cents, ex GST
  revenue: {
    invoiced: number; // cents — approved/sent/partial/paid
    wip: number; // cents — draft + pending_approval
    paid: number;
  };
  cost: {
    timesheet: number;
    expense: number;
    bill: number;
  };
  margin: number; // revenue.invoiced + revenue.wip - total cost
  hours: number; // total hours logged
  monthly: MonthlyRow[];
};

export type MonthlyRow = {
  month: string; // YYYY-MM
  revenue: number;
  cost: number;
};

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function computeProjectPnL(projectId: string): Promise<ProjectPnL> {
  const [project, invoices, expenses, bills, tsEntries] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { contractValue: true },
    }),
    prisma.invoice.findMany({
      where: { projectId },
      select: {
        amountExGst: true,
        amountTotal: true,
        paymentReceivedAmount: true,
        status: true,
        issueDate: true,
      },
    }),
    prisma.expense.findMany({
      where: { projectId, status: { in: ['approved', 'reimbursed', 'batched_for_payment'] } },
      select: { amount: true, gst: true, date: true },
    }),
    prisma.bill.findMany({
      where: { projectId, status: { in: ['approved', 'scheduled_for_payment', 'paid'] } },
      select: { amountTotal: true, gst: true, issueDate: true },
    }),
    prisma.timesheetEntry.findMany({
      where: { projectId, status: { in: ['approved', 'billed'] } },
      select: {
        hours: true,
        date: true,
        person: { select: { rate: true } },
      },
    }),
  ]);

  const revInvoiced = invoices
    .filter((i) => ['approved', 'sent', 'partial', 'paid'].includes(i.status))
    .reduce((s, i) => s + i.amountExGst, 0);
  const revWip = invoices
    .filter((i) => ['draft', 'pending_approval'].includes(i.status))
    .reduce((s, i) => s + i.amountExGst, 0);
  const revPaid = invoices.reduce((s, i) => s + (i.paymentReceivedAmount ?? 0), 0);

  const expenseCost = expenses.reduce((s, e) => s + (e.amount - e.gst), 0);
  const billCostExGst = bills.reduce((s, b) => s + (b.amountTotal - b.gst), 0);

  let hours = 0;
  let timesheetCost = 0;
  for (const e of tsEntries) {
    const h = Number(e.hours);
    hours += h;
    timesheetCost += Math.round(h * (e.person.rate ?? 0));
  }

  const monthlyMap = new Map<string, { revenue: number; cost: number }>();
  function bump(month: string, patch: Partial<{ revenue: number; cost: number }>) {
    const cur = monthlyMap.get(month) ?? { revenue: 0, cost: 0 };
    monthlyMap.set(month, {
      revenue: cur.revenue + (patch.revenue ?? 0),
      cost: cur.cost + (patch.cost ?? 0),
    });
  }
  for (const i of invoices) {
    if (['approved', 'sent', 'partial', 'paid'].includes(i.status)) {
      bump(ym(i.issueDate), { revenue: i.amountExGst });
    }
  }
  for (const e of expenses) bump(ym(e.date), { cost: e.amount - e.gst });
  for (const b of bills) bump(ym(b.issueDate), { cost: b.amountTotal - b.gst });
  for (const t of tsEntries) {
    bump(ym(t.date), { cost: Math.round(Number(t.hours) * (t.person.rate ?? 0)) });
  }
  const monthly = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const totalCost = timesheetCost + expenseCost + billCostExGst;
  const margin = revInvoiced + revWip - totalCost;

  return {
    contractValue: project.contractValue,
    revenue: { invoiced: revInvoiced, wip: revWip, paid: revPaid },
    cost: { timesheet: timesheetCost, expense: expenseCost, bill: billCostExGst },
    margin,
    hours,
    monthly,
  };
}
