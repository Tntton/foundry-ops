/**
 * FY budget → actuals reconciler.
 *
 * Reads the FyBudget row for a given financial year (top-line targets
 * + OPEX line items) and cross-refs each line against actual spend in
 * the FY window. Feeds the active-FY tab on /pnl.
 *
 * Actuals sources by budget line:
 *   - Revenue target      ↔ Invoice.amountExGst in FY window (status INVOICED)
 *   - Consultant cost     ↔ ContractorInvoice + TimesheetEntry × rate
 *   - Project expense     ↔ Expense + project-tagged Bill (both ex-GST)
 *   - OPEX line by ATO cat ↔ Bill.category matches, tagged to FH-buckets
 *   - EBIT target         ↔ Revenue − ConsultantCost − ProjectExpense − FirmOpex
 *
 * Everything returns cents so the UI can format consistently.
 */
import { prisma } from '@/server/db';
import { auFyWindow } from '@/lib/au-fy';

export type BudgetActualsLine = {
  id: string;
  label: string;
  atoCategory: string;
  vendor: string | null;
  isCarryOver: boolean;
  cadence: string;
  plannedCents: number;
  actualCents: number;
  varianceCents: number; // planned - actual (positive = under-budget)
  variancePct: number | null; // null when planned is 0
  notes: string | null;
};

export type BudgetActualsSummary = {
  label: string;
  plannedCents: number;
  actualCents: number;
  varianceCents: number;
  variancePct: number | null;
};

export type FyBudgetActuals = {
  yearEnding: number;
  hasBudget: boolean;
  budgetId: string | null;
  topLine: {
    revenue: BudgetActualsSummary;
    consultantCost: BudgetActualsSummary;
    projectExpense: BudgetActualsSummary;
    firmOpex: BudgetActualsSummary;
    ebit: BudgetActualsSummary;
  };
  opex: {
    byCategory: Array<{
      atoCategory: string;
      plannedCents: number;
      actualCents: number;
      varianceCents: number;
      variancePct: number | null;
      lines: BudgetActualsLine[];
    }>;
    totalPlannedCents: number;
    totalActualCents: number;
  };
};

const FH_BUCKET_CODES = ['FHB000', 'FHO000', 'FHX000'];

function summariseVariance(plannedCents: number, actualCents: number): BudgetActualsSummary {
  return {
    label: '',
    plannedCents,
    actualCents,
    varianceCents: plannedCents - actualCents,
    variancePct: plannedCents === 0 ? null : Math.round(((plannedCents - actualCents) / plannedCents) * 100),
  };
}

export async function computeFyBudgetActuals(yearEnding: number): Promise<FyBudgetActuals> {
  const { from, to } = auFyWindow(yearEnding);

  const [
    budget,
    fhBucketProjects,
    invoicesFy,
    contractorInvoicesFy,
    timesheetFy,
    expensesFy,
    firmOpexBillsFy,
    projectBillsFy,
  ] = await Promise.all([
    prisma.fyBudget.findUnique({
      where: { yearEnding },
      include: {
        opexLines: { orderBy: [{ atoCategory: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }] },
      },
    }),
    prisma.project.findMany({
      where: { code: { in: FH_BUCKET_CODES } },
      select: { id: true, code: true },
    }),
    prisma.invoice.findMany({
      where: {
        issueDate: { gte: from, lt: to },
        status: { in: ['approved', 'sent', 'partial', 'paid', 'overdue'] },
      },
      select: { amountExGst: true },
    }),
    prisma.contractorInvoice.findMany({
      where: { periodAnchor: { gte: from, lt: to } },
      select: { amountExGst: true },
    }),
    prisma.timesheetEntry.findMany({
      where: {
        date: { gte: from, lt: to },
        status: { in: ['approved', 'billed'] },
      },
      select: {
        hours: true,
        person: { select: { rate: true } },
      },
    }),
    prisma.expense.findMany({
      where: {
        date: { gte: from, lt: to },
        status: { in: ['approved', 'reimbursed', 'batched_for_payment'] },
        projectId: { not: null },
      },
      select: { amount: true, gst: true },
    }),
    // Firm OPEX bills: tagged to any FH-series bucket within window.
    prisma.bill.findMany({
      where: {
        issueDate: { gte: from, lt: to },
        status: { in: ['approved', 'scheduled_for_payment', 'paid'] },
        project: { code: { in: FH_BUCKET_CODES } },
      },
      select: { amountTotal: true, gst: true, category: true },
    }),
    // Project-tagged (non-bucket) bills — feed project-expense actuals.
    prisma.bill.findMany({
      where: {
        issueDate: { gte: from, lt: to },
        status: { in: ['approved', 'scheduled_for_payment', 'paid'] },
        project: { code: { notIn: FH_BUCKET_CODES } },
      },
      select: { amountTotal: true, gst: true },
    }),
  ]);
  void fhBucketProjects; // resolved for filter; not directly used

  // ─ Actuals ────────────────────────────────────────────────────────
  const revenueActualCents = invoicesFy.reduce((s, i) => s + i.amountExGst, 0);
  const contractorActualCents = contractorInvoicesFy.reduce((s, c) => s + c.amountExGst, 0);
  const timesheetActualCents = timesheetFy.reduce(
    (s, t) => s + Math.round(Number(t.hours) * (t.person.rate ?? 0)),
    0,
  );
  const consultantActualCents = contractorActualCents + timesheetActualCents;
  const expenseActualCents = expensesFy.reduce((s, e) => s + (e.amount - e.gst), 0);
  const projectBillActualCents = projectBillsFy.reduce((s, b) => s + (b.amountTotal - b.gst), 0);
  const projectExpenseActualCents = expenseActualCents + projectBillActualCents;
  const firmOpexActualCents = firmOpexBillsFy.reduce((s, b) => s + (b.amountTotal - b.gst), 0);
  const ebitActualCents =
    revenueActualCents - consultantActualCents - projectExpenseActualCents - firmOpexActualCents;

  // ─ Firm OPEX actuals by ATO category (matched via Bill.category) ──
  const firmOpexByCategory = new Map<string, number>();
  for (const b of firmOpexBillsFy) {
    const key = b.category || 'Other';
    firmOpexByCategory.set(key, (firmOpexByCategory.get(key) ?? 0) + (b.amountTotal - b.gst));
  }

  // ─ OPEX budget lines grouped by ATO category ──────────────────────
  const linesByCategory = new Map<string, BudgetActualsLine[]>();
  let totalPlannedOpexCents = 0;
  if (budget) {
    for (const line of budget.opexLines) {
      const list = linesByCategory.get(line.atoCategory) ?? [];
      // Per-line actual — we don't yet track vendor-level Bill matching,
      // so line-level actual defaults to 0. The category-level actual is
      // the source of truth for variance until vendor mapping is wired.
      const actualForLine = 0;
      list.push({
        id: line.id,
        label: line.label,
        atoCategory: line.atoCategory,
        vendor: line.vendor,
        isCarryOver: line.isCarryOver,
        cadence: line.cadence,
        plannedCents: line.plannedAnnualCents,
        actualCents: actualForLine,
        varianceCents: line.plannedAnnualCents - actualForLine,
        variancePct: line.plannedAnnualCents === 0
          ? null
          : Math.round(((line.plannedAnnualCents - actualForLine) / line.plannedAnnualCents) * 100),
        notes: line.notes,
      });
      linesByCategory.set(line.atoCategory, list);
      totalPlannedOpexCents += line.plannedAnnualCents;
    }
  }
  // Fold any actuals categories that the budget didn't itemise —
  // surfaces as their own group with no lines but with the category
  // total, so TT can see "we spent X on Recruitment we didn't plan for".
  for (const [cat, actualCents] of firmOpexByCategory.entries()) {
    if (!linesByCategory.has(cat)) linesByCategory.set(cat, []);
    // Category-level actual is stored on the category rollup below,
    // not on individual lines.
    void actualCents;
  }
  const byCategory = Array.from(linesByCategory.entries())
    .map(([atoCategory, lines]) => {
      const plannedCents = lines.reduce((s, l) => s + l.plannedCents, 0);
      const actualCents = firmOpexByCategory.get(atoCategory) ?? 0;
      return {
        atoCategory,
        plannedCents,
        actualCents,
        varianceCents: plannedCents - actualCents,
        variancePct: plannedCents === 0 ? null : Math.round(((plannedCents - actualCents) / plannedCents) * 100),
        lines,
      };
    })
    .sort((a, b) => b.plannedCents - a.plannedCents || b.actualCents - a.actualCents);

  const revenueTarget = budget?.revenueTargetCents ?? 0;
  const consultantTarget = budget?.consultantCostTargetCents ?? 0;
  const projectExpenseTarget = budget?.projectExpenseTargetCents ?? 0;
  const ebitTarget = budget?.ebitTargetCents ?? 0;

  return {
    yearEnding,
    hasBudget: budget !== null,
    budgetId: budget?.id ?? null,
    topLine: {
      revenue: { ...summariseVariance(revenueTarget, revenueActualCents), label: 'Revenue' },
      consultantCost: { ...summariseVariance(consultantTarget, consultantActualCents), label: 'Consultant cost' },
      projectExpense: { ...summariseVariance(projectExpenseTarget, projectExpenseActualCents), label: 'Project expenses' },
      firmOpex: { ...summariseVariance(totalPlannedOpexCents, firmOpexActualCents), label: 'Company OPEX' },
      ebit: { ...summariseVariance(ebitTarget, ebitActualCents), label: 'EBIT' },
    },
    opex: {
      byCategory,
      totalPlannedCents: totalPlannedOpexCents,
      totalActualCents: firmOpexActualCents,
    },
  };
}
