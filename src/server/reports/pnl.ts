import { prisma } from '@/server/db';

export type PerProjectPnL = {
  projectId: string;
  code: string;
  name: string;
  stage: string;
  clientCode: string;
  contractValueCents: number;
  revenueCents: number; // invoiced (approved/sent/partial/paid/overdue) ex GST
  wipCents: number; // draft + pending_approval invoices ex GST
  costCents: number; // timesheet + expense + bill
  marginCents: number; // revenue + wip − cost
  hours: number;
};

export type MonthlyRollup = {
  month: string; // YYYY-MM
  revenueCents: number;
  costCents: number;
};

export type FirmPnL = {
  projects: PerProjectPnL[];
  totals: {
    contractValueCents: number;
    revenueCents: number;
    wipCents: number;
    costCents: number;
    marginCents: number;
    hours: number;
  };
  monthly: MonthlyRollup[];
};

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Firm-wide P&L aggregated across every project. Reuses the same accounting
 * logic as the project-level computeProjectPnL (Person.rate for timesheet
 * cost, approved bills ex GST, etc.) but runs a single query per kind and
 * rolls up. Archived projects are included — their history still counts for
 * lifetime margin.
 */
export async function computeFirmPnL(): Promise<FirmPnL> {
  const [projects, invoices, expenses, bills, timesheet] = await Promise.all([
    prisma.project.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        stage: true,
        contractValue: true,
        client: { select: { code: true } },
      },
    }),
    prisma.invoice.findMany({
      select: {
        projectId: true,
        amountExGst: true,
        status: true,
        issueDate: true,
      },
    }),
    prisma.expense.findMany({
      where: { status: { in: ['approved', 'reimbursed', 'batched_for_payment'] } },
      select: { projectId: true, amount: true, gst: true, date: true },
    }),
    prisma.bill.findMany({
      where: { status: { in: ['approved', 'scheduled_for_payment', 'paid'] } },
      select: { projectId: true, amountTotal: true, gst: true, issueDate: true },
    }),
    prisma.timesheetEntry.findMany({
      where: { status: { in: ['approved', 'billed'] } },
      select: {
        projectId: true,
        hours: true,
        date: true,
        person: { select: { rate: true } },
      },
    }),
  ]);

  const INVOICED = new Set(['approved', 'sent', 'partial', 'paid', 'overdue']);
  const WIP = new Set(['draft', 'pending_approval']);

  const perProject = new Map<string, PerProjectPnL>();
  const monthly = new Map<string, MonthlyRollup>();

  for (const p of projects) {
    perProject.set(p.id, {
      projectId: p.id,
      code: p.code,
      name: p.name,
      stage: p.stage,
      clientCode: p.client.code,
      contractValueCents: p.contractValue,
      revenueCents: 0,
      wipCents: 0,
      costCents: 0,
      marginCents: 0,
      hours: 0,
    });
  }

  function bumpMonth(month: string, patch: Partial<{ revenueCents: number; costCents: number }>) {
    const cur = monthly.get(month) ?? { month, revenueCents: 0, costCents: 0 };
    cur.revenueCents += patch.revenueCents ?? 0;
    cur.costCents += patch.costCents ?? 0;
    monthly.set(month, cur);
  }

  for (const inv of invoices) {
    const row = perProject.get(inv.projectId);
    if (INVOICED.has(inv.status)) {
      if (row) row.revenueCents += inv.amountExGst;
      bumpMonth(ym(inv.issueDate), { revenueCents: inv.amountExGst });
    } else if (WIP.has(inv.status)) {
      if (row) row.wipCents += inv.amountExGst;
      // WIP not recorded on monthly revenue — will count when invoiced.
    }
  }

  for (const e of expenses) {
    if (!e.projectId) continue;
    const exGst = e.amount - e.gst;
    const row = perProject.get(e.projectId);
    if (row) row.costCents += exGst;
    bumpMonth(ym(e.date), { costCents: exGst });
  }

  for (const b of bills) {
    if (!b.projectId) continue;
    const exGst = b.amountTotal - b.gst;
    const row = perProject.get(b.projectId);
    if (row) row.costCents += exGst;
    bumpMonth(ym(b.issueDate), { costCents: exGst });
  }

  for (const t of timesheet) {
    const hours = Number(t.hours);
    const cost = Math.round(hours * (t.person.rate ?? 0));
    const row = perProject.get(t.projectId);
    if (row) {
      row.costCents += cost;
      row.hours += hours;
    }
    bumpMonth(ym(t.date), { costCents: cost });
  }

  for (const row of perProject.values()) {
    row.marginCents = row.revenueCents + row.wipCents - row.costCents;
  }

  const projectsArr = [...perProject.values()].sort(
    (a, b) => b.marginCents - a.marginCents,
  );
  const monthlyArr = [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month));

  const totals = projectsArr.reduce(
    (acc, p) => ({
      contractValueCents: acc.contractValueCents + p.contractValueCents,
      revenueCents: acc.revenueCents + p.revenueCents,
      wipCents: acc.wipCents + p.wipCents,
      costCents: acc.costCents + p.costCents,
      marginCents: acc.marginCents + p.marginCents,
      hours: acc.hours + p.hours,
    }),
    {
      contractValueCents: 0,
      revenueCents: 0,
      wipCents: 0,
      costCents: 0,
      marginCents: 0,
      hours: 0,
    },
  );

  return { projects: projectsArr, totals, monthly: monthlyArr };
}
