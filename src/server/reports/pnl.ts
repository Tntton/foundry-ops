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
  /** Consultant cost — TimesheetEntry × rate + ContractorInvoice ex-GST.
   *  What the master tracker's "Consultant Cost & Expenses" tab shows. */
  consultantCostCents: number;
  /** Project-tagged materials / bills / expenses (ex-GST). Distinct
   *  from firm OPEX (which is untagged / bucket-tagged spend). */
  projectExpenseCents: number;
  /** Legacy total = consultantCost + projectExpense. Kept for the
   *  callers still summing this way. */
  costCents: number;
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
    /** Sum of every project's consultantCostCents. */
    consultantCostCents: number;
    /** Sum of every project's projectExpenseCents. */
    projectExpenseCents: number;
    /** Firm OPEX — bills tagged to the FH-series overhead buckets
     *  (FHB000 / FHO000 / FHX000). What the master tracker's
     *  "Company OPEX" line sums to. */
    firmOpexCents: number;
    /** Legacy = consultantCost + projectExpense (matches per-project
     *  totals). Excludes firmOpex — that's a separate line. */
    costCents: number;
    /** Revenue − consultantCost − projectExpense. Matches the tracker's
     *  "Gross Profit" line. */
    grossProfitCents: number;
    /** Gross Profit − Firm OPEX. Matches the tracker's EBIT line. */
    ebitCents: number;
    /** Legacy = revenue + wip − cost. */
    marginCents: number;
    hours: number;
  };
  monthly: MonthlyRollup[];
  /** All-time totals, unaffected by any FY filter — surfaces as the
   *  "firm earnings to date" tile. Computed inside the same helper so
   *  callers get one round-trip. */
  cumulative: {
    /** Sum of every invoice ex-GST, regardless of status or date. */
    revenueCents: number;
    /** Sum of every payment received (paymentReceivedAmount). */
    receivedCents: number;
    /** Sum of every project's contract value. Includes archived. */
    contractsWonCents: number;
  };
};

export type FirmPnLOpts = {
  /** Inclusive lower bound on the date fields (issueDate / date /
   *  periodAnchor) for filtering by FY. Omit for all-time. */
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
};

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Firm-wide P&L aggregated across every project. Reuses the same accounting
 * logic as the project-level computeProjectPnL (Person.rate for timesheet
 * cost, approved bills ex GST, etc.) but runs a single query per kind and
 * rolls up.
 *
 * Optional `opts.from` / `opts.to` narrow every date-anchored input
 * (invoices, expenses, bills, timesheets, contractor invoices) to a
 * half-open [from, to) window — used by the /pnl FY selector. When
 * omitted, all-time.
 *
 * `cumulative` totals always ignore the window — they're the "firm
 * earnings to date" figure surfaced on the page's top tile.
 */
export async function computeFirmPnL(opts?: FirmPnLOpts): Promise<FirmPnL> {
  const dateWindow = opts?.from && opts?.to
    ? { gte: opts.from, lt: opts.to }
    : opts?.from
      ? { gte: opts.from }
      : opts?.to
        ? { lt: opts.to }
        : undefined;
  const hasWindow = dateWindow !== undefined;
  // Hide the firm-overhead expense buckets (FHB000 / FHO000 / FHX000)
  // from firm P&L roll-ups — they distort margin numbers because they
  // have zero contract value but accrue cost. Internal FH projects
  // (FHP*) keep showing.
  const BUCKET_CODES = ['FHB000', 'FHO000', 'FHX000'];
  const [projects, bucketProjects, invoices, expenses, bills, timesheet, contractorInvoices, cumulative] = await Promise.all([
    prisma.project.findMany({
      where: { code: { notIn: BUCKET_CODES } },
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
    // Separate query for FH-bucket projects — we need their IDs to
    // sum firm OPEX from bills tagged to them.
    prisma.project.findMany({
      where: { code: { in: BUCKET_CODES } },
      select: { id: true, code: true },
    }),
    prisma.invoice.findMany({
      where: hasWindow ? { issueDate: dateWindow } : {},
      select: {
        projectId: true,
        amountExGst: true,
        status: true,
        issueDate: true,
      },
    }),
    prisma.expense.findMany({
      where: {
        status: { in: ['approved', 'reimbursed', 'batched_for_payment'] },
        ...(hasWindow ? { date: dateWindow } : {}),
      },
      select: { projectId: true, amount: true, gst: true, date: true },
    }),
    prisma.bill.findMany({
      where: {
        status: { in: ['approved', 'scheduled_for_payment', 'paid'] },
        ...(hasWindow ? { issueDate: dateWindow } : {}),
      },
      select: { projectId: true, amountTotal: true, gst: true, issueDate: true },
    }),
    prisma.timesheetEntry.findMany({
      where: {
        status: { in: ['approved', 'billed'] },
        ...(hasWindow ? { date: dateWindow } : {}),
      },
      select: {
        projectId: true,
        hours: true,
        date: true,
        person: { select: { rate: true } },
      },
    }),
    // Historical contractor invoices — pre-platform aggregated cost.
    // Feeds consultantCost alongside live timesheet cost.
    prisma.contractorInvoice.findMany({
      where: hasWindow ? { periodAnchor: dateWindow } : {},
      select: { projectId: true, hours: true, amountExGst: true, periodAnchor: true },
    }),
    // Cumulative — always unfiltered so the "firm earnings to date" tile
    // is stable across FY switches.
    Promise.all([
      prisma.invoice.aggregate({
        _sum: { amountExGst: true, paymentReceivedAmount: true },
      }),
      prisma.project.aggregate({
        where: { code: { notIn: BUCKET_CODES } },
        _sum: { contractValue: true },
      }),
    ]).then(([inv, prj]) => ({
      revenueCents: inv._sum.amountExGst ?? 0,
      receivedCents: inv._sum.paymentReceivedAmount ?? 0,
      contractsWonCents: prj._sum.contractValue ?? 0,
    })),
  ]);
  const bucketProjectIds = new Set(bucketProjects.map((p) => p.id));

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
      consultantCostCents: 0,
      projectExpenseCents: 0,
      costCents: 0,
      marginCents: 0,
      hours: 0,
    });
  }
  // Track firm OPEX separately — bills tagged to FH-bucket projects.
  let firmOpexCents = 0;

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
    if (row) {
      row.projectExpenseCents += exGst;
      row.costCents += exGst;
    }
    bumpMonth(ym(e.date), { costCents: exGst });
  }

  for (const b of bills) {
    if (!b.projectId) continue;
    const exGst = b.amountTotal - b.gst;
    if (bucketProjectIds.has(b.projectId)) {
      // Firm OPEX — bills tagged to FH-series overhead buckets.
      // Sits below the gross-profit line, not inside project cost.
      firmOpexCents += exGst;
      bumpMonth(ym(b.issueDate), { costCents: exGst });
      continue;
    }
    const row = perProject.get(b.projectId);
    if (row) {
      row.projectExpenseCents += exGst;
      row.costCents += exGst;
    }
    bumpMonth(ym(b.issueDate), { costCents: exGst });
  }

  for (const t of timesheet) {
    const hours = Number(t.hours);
    const cost = Math.round(hours * (t.person.rate ?? 0));
    const row = perProject.get(t.projectId);
    if (row) {
      row.consultantCostCents += cost;
      row.costCents += cost;
      row.hours += hours;
    }
    bumpMonth(ym(t.date), { costCents: cost });
  }

  for (const c of contractorInvoices) {
    const row = perProject.get(c.projectId);
    if (row) {
      row.consultantCostCents += c.amountExGst;
      row.costCents += c.amountExGst;
      row.hours += Number(c.hours);
    }
    bumpMonth(ym(c.periodAnchor), { costCents: c.amountExGst });
  }

  for (const row of perProject.values()) {
    row.marginCents = row.revenueCents + row.wipCents - row.costCents;
  }

  const projectsArr = [...perProject.values()].sort(
    (a, b) => b.marginCents - a.marginCents,
  );
  const monthlyArr = [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month));

  const partialTotals = projectsArr.reduce(
    (acc, p) => ({
      contractValueCents: acc.contractValueCents + p.contractValueCents,
      revenueCents: acc.revenueCents + p.revenueCents,
      wipCents: acc.wipCents + p.wipCents,
      consultantCostCents: acc.consultantCostCents + p.consultantCostCents,
      projectExpenseCents: acc.projectExpenseCents + p.projectExpenseCents,
      costCents: acc.costCents + p.costCents,
      marginCents: acc.marginCents + p.marginCents,
      hours: acc.hours + p.hours,
    }),
    {
      contractValueCents: 0,
      revenueCents: 0,
      wipCents: 0,
      consultantCostCents: 0,
      projectExpenseCents: 0,
      costCents: 0,
      marginCents: 0,
      hours: 0,
    },
  );
  const grossProfitCents =
    partialTotals.revenueCents -
    partialTotals.consultantCostCents -
    partialTotals.projectExpenseCents;
  const ebitCents = grossProfitCents - firmOpexCents;

  return {
    projects: projectsArr,
    totals: { ...partialTotals, firmOpexCents, grossProfitCents, ebitCents },
    monthly: monthlyArr,
    cumulative,
  };
}
