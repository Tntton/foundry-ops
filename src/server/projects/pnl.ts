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
  // Serialized fan-out — Supabase's session-mode pgbouncer caps us at 15
  // connections and the project page already calls several helpers each
  // with their own internal Promise.all. Issuing these one-by-one keeps
  // peak concurrency low. Per-query latency is small (<150ms) so the
  // total stays well under the page's render budget.
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { contractValue: true },
  });
  const invoices = await prisma.invoice.findMany({
    where: { projectId },
    select: {
      amountExGst: true,
      amountTotal: true,
      paymentReceivedAmount: true,
      status: true,
      issueDate: true,
    },
  });
  const expenses = await prisma.expense.findMany({
    where: { projectId, status: { in: ['approved', 'reimbursed', 'batched_for_payment'] } },
    select: { amount: true, gst: true, date: true },
  });
  const bills = await prisma.bill.findMany({
    where: { projectId, status: { in: ['approved', 'scheduled_for_payment', 'paid'] } },
    select: { amountTotal: true, gst: true, issueDate: true },
  });
  const tsEntries = await prisma.timesheetEntry.findMany({
    where: { projectId, status: { in: ['approved', 'billed'] } },
    select: {
      hours: true,
      date: true,
      personId: true,
      person: { select: { rate: true } },
    },
  });
  // Per-project rate overrides — when a ProjectTeam row carries a
  // customRateCents we use that for every hour the person logs on
  // this project. Falls back to Person.rate when no override is set
  // (or for ghost contributors without a roster row).
  const teamRates = await prisma.projectTeam.findMany({
    where: { projectId },
    select: { personId: true, customRateCents: true },
  });
  const customRateByPerson = new Map<string, number>();
  for (const t of teamRates) {
    if (t.customRateCents !== null && t.customRateCents !== undefined) {
      customRateByPerson.set(t.personId, t.customRateCents);
    }
  }
  const costRateFor = (personId: string, fallback: number | null): number =>
    customRateByPerson.get(personId) ?? fallback ?? 0;

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
    timesheetCost += Math.round(h * costRateFor(e.personId, e.person.rate));
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
    bump(ym(t.date), {
      cost: Math.round(
        Number(t.hours) * costRateFor(t.personId, t.person.rate),
      ),
    });
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
