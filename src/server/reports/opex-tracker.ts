/**
 * OPEX tracker — the office manager's operational view of firm
 * overhead. Where /pnl answers "how is the firm doing" for partners,
 * this answers Jas's day-to-day questions:
 *
 *   - What have we spent this FY, by ATO category and by month?
 *   - How does the run-rate track against the FY budget?
 *   - Which OPEX bills are still unpaid / awaiting review?
 *   - What did we spend that was never budgeted?
 *
 * Builds on computeFyBudgetActuals (budget ↔ actual variance) and
 * adds the month × category matrix + the open-bills pipeline.
 * "Firm OPEX" = bills tagged to the FH bucket projects (FHB000 /
 * FHO000 / FHX000), consistent with the P&L + budget reconciler.
 */
import { prisma } from '@/server/db';
import { auFyWindow } from '@/lib/au-fy';
import {
  computeFyBudgetActuals,
  type FyBudgetActuals,
} from '@/server/reports/fy-budget';

const FH_BUCKET_CODES = ['FHB000', 'FHO000', 'FHX000'];

export type OpexMonthCell = {
  /** 0-based month index within the FY (0 = July). */
  fyMonth: number;
  cents: number;
};

export type OpexCategoryRow = {
  atoCategory: string;
  /** 12 entries, July → June, ex-GST cents. */
  months: number[];
  totalCents: number;
};

export type OpenOpexBill = {
  id: string;
  supplierName: string | null;
  supplierInvoiceNumber: string | null;
  category: string | null;
  amountTotal: number;
  gst: number;
  dueDate: Date;
  status: string;
  bucketCode: string;
};

export type OpexTracker = {
  yearEnding: number;
  budget: FyBudgetActuals;
  /** month × category matrix of PAID/approved firm-OPEX spend. */
  matrix: OpexCategoryRow[];
  monthTotals: number[]; // 12 entries, July → June
  totalActualCents: number;
  /** Simple annualised run-rate: actual-to-date ÷ months elapsed × 12.
   *  Null before the FY starts or when nothing is spent. */
  runRateCents: number | null;
  monthsElapsed: number;
  /** Unpaid pipeline — pending review / approved / scheduled, oldest
   *  due first. These are NOT in the actuals above until approved. */
  openBills: OpenOpexBill[];
};

const MONTH_LABELS_FY = [
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
] as const;

export function fyMonthLabel(fyMonth: number): string {
  return MONTH_LABELS_FY[fyMonth] ?? '?';
}

/** Calendar month (0-11) → FY month index (0 = July). */
function toFyMonth(d: Date): number {
  return (d.getUTCMonth() + 6) % 12;
}

export async function computeOpexTracker(yearEnding: number): Promise<OpexTracker> {
  const { from, to } = auFyWindow(yearEnding);

  const [budget, paidBills, openBillRows] = await Promise.all([
    computeFyBudgetActuals(yearEnding),
    prisma.bill.findMany({
      where: {
        issueDate: { gte: from, lt: to },
        status: { in: ['approved', 'scheduled_for_payment', 'paid'] },
        project: { code: { in: FH_BUCKET_CODES } },
      },
      select: { issueDate: true, amountTotal: true, gst: true, category: true },
    }),
    prisma.bill.findMany({
      where: {
        status: { in: ['pending_review', 'approved', 'scheduled_for_payment'] },
        project: { code: { in: FH_BUCKET_CODES } },
      },
      orderBy: { dueDate: 'asc' },
      take: 30,
      select: {
        id: true,
        supplierName: true,
        supplierInvoiceNumber: true,
        category: true,
        amountTotal: true,
        gst: true,
        dueDate: true,
        status: true,
        project: { select: { code: true } },
      },
    }),
  ]);

  // Month × category matrix (ex GST).
  const byCategory = new Map<string, number[]>();
  const monthTotals = Array.from({ length: 12 }, () => 0);
  let totalActualCents = 0;
  for (const b of paidBills) {
    const cat = b.category || 'Other';
    const m = toFyMonth(b.issueDate);
    const ex = b.amountTotal - b.gst;
    const row = byCategory.get(cat) ?? Array.from({ length: 12 }, () => 0);
    row[m] = (row[m] ?? 0) + ex;
    byCategory.set(cat, row);
    monthTotals[m] = (monthTotals[m] ?? 0) + ex;
    totalActualCents += ex;
  }
  const matrix: OpexCategoryRow[] = Array.from(byCategory.entries())
    .map(([atoCategory, months]) => ({
      atoCategory,
      months,
      totalCents: months.reduce((s, c) => s + c, 0),
    }))
    .sort((a, b) => b.totalCents - a.totalCents);

  // Run-rate: whole months elapsed within the FY window (min 1 once
  // the FY has started, capped at 12).
  const now = new Date();
  let monthsElapsed = 0;
  if (now >= from) {
    const end = now < to ? now : to;
    monthsElapsed = Math.min(
      12,
      Math.max(
        1,
        (end.getUTCFullYear() - from.getUTCFullYear()) * 12 +
          (end.getUTCMonth() - from.getUTCMonth()) +
          1,
      ),
    );
  }
  const runRateCents =
    monthsElapsed > 0 && totalActualCents > 0
      ? Math.round((totalActualCents / monthsElapsed) * 12)
      : null;

  return {
    yearEnding,
    budget,
    matrix,
    monthTotals,
    totalActualCents,
    runRateCents,
    monthsElapsed,
    openBills: openBillRows.map((b) => ({
      id: b.id,
      supplierName: b.supplierName,
      supplierInvoiceNumber: b.supplierInvoiceNumber,
      category: b.category,
      amountTotal: b.amountTotal,
      gst: b.gst,
      dueDate: b.dueDate,
      status: b.status,
      bucketCode: b.project?.code ?? '—',
    })),
  };
}
