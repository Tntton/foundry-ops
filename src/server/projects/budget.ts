import { prisma } from '@/server/db';
import type { ProjectBudgetCategory } from '@prisma/client';

/**
 * Project finance tracker — forecast cascade + actuals reconciliation.
 *
 * Implements the FY26 governance "future project-level financial
 * tracking" model:
 *
 *   Total fee
 *     − OPEX contribution (20% fixed, configurable per-project)
 *     − BD referral (0–10% capped at $50k; 0% when source is partner)
 *     − Project expenses (line items: rate × units/week × weeks)
 *     ───────────────────
 *     Net costs
 *
 *   Net revenue = Total fee − Net costs
 *     − Firm profit pool (15% fixed)
 *     ───────────────────
 *     Project LT share (residual; default 1/3 split across leadership)
 *
 * Reconciliation against actuals (timesheets / expenses / bills) folds
 * realised spend into the same buckets so partners can see forecast vs
 * actual side-by-side as the project runs.
 */

export type BudgetLineComputed = {
  id: string;
  category: ProjectBudgetCategory;
  description: string;
  rateCents: number;
  unitsPerWeek: number;
  weeks: number;
  forecastCents: number; // rateCents × unitsPerWeek × weeks (rounded)
  actualCents: number;
  variancePct: number | null; // (actual − forecast) / forecast × 100
  comment: string | null;
  sortOrder: number;
};

export type BudgetTotals = {
  totalFeeCents: number;
  opexContributionCents: number;
  bdReferralCents: number;
  bdReferralCapped: boolean;
  projectExpenseForecastCents: number;
  projectExpenseActualCents: number;
  netCostsForecastCents: number;
  netRevenueForecastCents: number;
  firmProfitPoolCents: number;
  ltProjectShareCents: number;
  projectExpensePctOfFee: number; // forecast / fee
  netRevenuePctOfFee: number;
  ltSharePctOfFee: number;
};

export type BudgetActualsBreakdown = {
  /** Sum of timesheet × person.rate for entries on this project. */
  timesheetCents: number;
  /** Approved + reimbursed + batched expenses, by category. */
  expensesByCategoryCents: Record<string, number>;
  /** Approved + scheduled + paid bills tied to the project. */
  billsCents: number;
  /** All-in actual cost for the project so far. */
  totalCents: number;
};

export type ProjectBudgetMeta = {
  hasBudget: boolean;
  numberOfWeeks: number;
  totalFeeCents: number;
  opexContributionPct: number;
  bdReferralPct: number;
  bdReferralCapCents: number;
  firmProfitPoolPct: number;
  ltShareCount: number;
  notes: string | null;
};

export type ProjectBudgetView = {
  meta: ProjectBudgetMeta;
  lines: BudgetLineComputed[];
  totals: BudgetTotals;
  actuals: BudgetActualsBreakdown;
};

const BAND_TO_BUDGET: Record<string, ProjectBudgetCategory> = {
  // Map person.band onto a budget bucket so timesheet actuals reconcile
  // to the same line categories the forecast uses.
  MP: 'partner_lt',
  Partner: 'partner_lt',
  Expert: 'expert_paid',
  Consultant: 'consultant',
  Analyst: 'analyst',
};

// Map the canonical expense / bill category set (Xero-aligned, see
// src/lib/expense-categories.ts) onto the project-budget line buckets.
// Anything that doesn't have an obvious bucket falls through to
// 'project_resources' — admin can re-code on the budget tab if needed.
const EXPENSE_CATEGORY_TO_BUDGET: Record<string, ProjectBudgetCategory> = {
  travel: 'travel',
  motor_vehicle: 'travel',
  meals_entertainment: 'meals',
  office_supplies: 'project_resources',
  computer_equipment: 'project_resources',
  software_subscriptions: 'project_resources',
  telephone_internet: 'project_resources',
  professional_fees: 'project_resources',
  subcontractor_fees: 'project_resources',
  marketing_bd: 'project_resources',
  training_conferences: 'project_resources',
  insurance: 'project_resources',
  memberships: 'project_resources',
  bank_fees: 'project_resources',
  utilities: 'project_resources',
  rent: 'project_resources',
  repairs_maintenance: 'project_resources',
  other: 'project_resources',
};

/**
 * Default line template seeded when a project budget is first
 * created. Mirrors the prototype: 8 lines covering the personnel
 * pyramid + project resources + travel + meals. Rates are AUD cents.
 */
export const DEFAULT_BUDGET_LINES: Array<{
  category: ProjectBudgetCategory;
  description: string;
  rateCents: number;
  unitsPerWeek: number;
  comment: string;
}> = [
  {
    category: 'partner_lt',
    description: 'Leadership team',
    rateCents: 200000,
    unitsPerWeek: 7.5,
    comment:
      '1.5 FTE across 3 LTs (0.5 each) — adjust for differential time / expert partners',
  },
  {
    category: 'manager',
    description: 'Manager',
    rateCents: 110000,
    unitsPerWeek: 5,
    comment: '1 FTE manager',
  },
  {
    category: 'consultant',
    description: 'Consultant',
    rateCents: 80000,
    unitsPerWeek: 2.5,
    comment: '0.5 FTE consultant',
  },
  {
    category: 'analyst',
    description: 'Analysts',
    rateCents: 40000,
    unitsPerWeek: 5,
    comment: '1 FTE analyst (daily coverage)',
  },
  {
    category: 'expert_paid',
    description: 'Experts (paid hourly)',
    rateCents: 25000,
    unitsPerWeek: 4,
    comment: 'Estimate ~4 hrs/week — higher for US experts',
  },
  {
    category: 'project_resources',
    description: 'Project resources',
    rateCents: 20000,
    unitsPerWeek: 1,
    comment: 'Hawksparks / expert networks / software',
  },
  {
    category: 'travel',
    description: 'Travel',
    rateCents: 20000,
    unitsPerWeek: 1,
    comment: 'Travel to client site',
  },
  {
    category: 'meals',
    description: 'Meals',
    rateCents: 20000,
    unitsPerWeek: 1,
    comment: 'Team / client meals',
  },
];

function lineForecast(
  rateCents: number,
  unitsPerWeek: number,
  weeks: number,
): number {
  return Math.round(rateCents * unitsPerWeek * weeks);
}

/**
 * Suggest a sensible `numberOfWeeks` for a brand-new budget — uses
 * actual project dates if both are set, otherwise falls back to 12.
 */
export function defaultWeeksForProject(
  startDate: Date | null,
  endDate: Date | null,
): number {
  if (!startDate || !endDate) return 12;
  const ms = endDate.getTime() - startDate.getTime();
  if (ms <= 0) return 12;
  return Math.max(1, Math.round(ms / (7 * 24 * 3600 * 1000)));
}

export async function computeProjectBudget(
  projectId: string,
): Promise<ProjectBudgetView | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      contractValue: true,
      startDate: true,
      endDate: true,
    },
  });
  if (!project) return null;

  // Sequential queries to stay within the pgbouncer pool.
  const budget = await prisma.projectBudget.findUnique({
    where: { projectId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });

  // Pull actuals regardless of whether a budget exists — this lets the
  // empty-state UI still show real spend so partners can decide whether
  // to scenario-plan.
  const expenses = await prisma.expense.findMany({
    where: {
      projectId,
      status: { in: ['approved', 'reimbursed', 'batched_for_payment'] },
    },
    select: { amount: true, gst: true, category: true },
  });
  const bills = await prisma.bill.findMany({
    where: {
      projectId,
      status: { in: ['approved', 'scheduled_for_payment', 'paid'] },
    },
    select: { amountTotal: true, gst: true },
  });
  const tsEntries = await prisma.timesheetEntry.findMany({
    where: { projectId, status: { in: ['approved', 'billed'] } },
    select: {
      hours: true,
      person: { select: { rate: true, band: true } },
    },
  });

  // ── Aggregate actuals into budget categories ────────────────────
  const actualByCategory = new Map<ProjectBudgetCategory, number>();
  function bumpActual(cat: ProjectBudgetCategory, cents: number) {
    actualByCategory.set(cat, (actualByCategory.get(cat) ?? 0) + cents);
  }
  let timesheetCents = 0;
  for (const t of tsEntries) {
    const cents = Math.round(Number(t.hours) * (t.person.rate ?? 0));
    timesheetCents += cents;
    const cat = BAND_TO_BUDGET[t.person.band] ?? 'other';
    bumpActual(cat, cents);
  }
  const expensesByCategoryCents: Record<string, number> = {};
  for (const e of expenses) {
    const exGst = e.amount - e.gst;
    expensesByCategoryCents[e.category] =
      (expensesByCategoryCents[e.category] ?? 0) + exGst;
    const cat = EXPENSE_CATEGORY_TO_BUDGET[e.category] ?? 'other';
    bumpActual(cat, exGst);
  }
  let billsCents = 0;
  for (const b of bills) {
    const exGst = b.amountTotal - b.gst;
    billsCents += exGst;
    // Bills with no project category mapping land in "other".
    bumpActual('other', exGst);
  }
  const actuals: BudgetActualsBreakdown = {
    timesheetCents,
    expensesByCategoryCents,
    billsCents,
    totalCents: timesheetCents + billsCents +
      Object.values(expensesByCategoryCents).reduce((s, v) => s + v, 0),
  };

  // ── Build line view ────────────────────────────────────────────
  const lines: BudgetLineComputed[] = (budget?.lines ?? []).map((l) => {
    const units = Number(l.unitsPerWeek);
    const forecast = lineForecast(l.rateCents, units, l.weeks);
    const actual = actualByCategory.get(l.category) ?? 0;
    const variancePct =
      forecast > 0 ? Math.round(((actual - forecast) / forecast) * 100) : null;
    return {
      id: l.id,
      category: l.category,
      description: l.description,
      rateCents: l.rateCents,
      unitsPerWeek: units,
      weeks: l.weeks,
      forecastCents: forecast,
      actualCents: actual,
      variancePct,
      comment: l.comment ?? null,
      sortOrder: l.sortOrder,
    };
  });

  // ── Cascade ────────────────────────────────────────────────────
  const meta: ProjectBudgetMeta = budget
    ? {
        hasBudget: true,
        numberOfWeeks: budget.numberOfWeeks,
        totalFeeCents: budget.totalFeeCents,
        opexContributionPct: budget.opexContributionPct,
        bdReferralPct: budget.bdReferralPct,
        bdReferralCapCents: budget.bdReferralCapCents,
        firmProfitPoolPct: budget.firmProfitPoolPct,
        ltShareCount: budget.ltShareCount,
        notes: budget.notes,
      }
    : {
        hasBudget: false,
        numberOfWeeks: defaultWeeksForProject(
          project.startDate,
          project.endDate,
        ),
        totalFeeCents: project.contractValue,
        opexContributionPct: 20,
        bdReferralPct: 0,
        bdReferralCapCents: 5_000_000,
        firmProfitPoolPct: 15,
        ltShareCount: 3,
        notes: null,
      };

  const fee = meta.totalFeeCents;
  const opexContributionCents = Math.round(
    (fee * meta.opexContributionPct) / 100,
  );
  const bdReferralRaw = Math.round((fee * meta.bdReferralPct) / 100);
  const bdReferralCents = Math.min(bdReferralRaw, meta.bdReferralCapCents);
  const bdReferralCapped = bdReferralRaw > meta.bdReferralCapCents;
  const projectExpenseForecastCents = lines.reduce(
    (s, l) => s + l.forecastCents,
    0,
  );
  const projectExpenseActualCents = actuals.totalCents;
  const netCostsForecastCents =
    opexContributionCents + bdReferralCents + projectExpenseForecastCents;
  const netRevenueForecastCents = fee - netCostsForecastCents;
  const firmProfitPoolCents = Math.round(
    (fee * meta.firmProfitPoolPct) / 100,
  );
  const ltProjectShareCents = netRevenueForecastCents - firmProfitPoolCents;

  const totals: BudgetTotals = {
    totalFeeCents: fee,
    opexContributionCents,
    bdReferralCents,
    bdReferralCapped,
    projectExpenseForecastCents,
    projectExpenseActualCents,
    netCostsForecastCents,
    netRevenueForecastCents,
    firmProfitPoolCents,
    ltProjectShareCents,
    projectExpensePctOfFee:
      fee > 0
        ? Math.round((projectExpenseForecastCents / fee) * 100 * 10) / 10
        : 0,
    netRevenuePctOfFee:
      fee > 0
        ? Math.round((netRevenueForecastCents / fee) * 100 * 10) / 10
        : 0,
    ltSharePctOfFee:
      fee > 0
        ? Math.round((ltProjectShareCents / fee) * 100 * 10) / 10
        : 0,
  };

  return { meta, lines, totals, actuals };
}
