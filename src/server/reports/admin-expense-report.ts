import { prisma } from '@/server/db';

/**
 * Admin-only firm-overhead expense report.
 *
 * The user-product decision (TT, 2026-05-10) is that admins see the
 * firm-overhead expense buckets — FHO000 (Operations) and FHX000
 * (BD / Other) — as a vendor/amount table on their dashboard, NOT as
 * project tiles with progress/margin/AR. Project metrics are meaningless
 * for buckets (no contract value, no client, no team).
 *
 * Bills + Expenses tagged to one of those buckets feed this report,
 * grouped by supplier/vendor with the bucket as a column. Rejected
 * lines are excluded.
 */
const BUCKET_CODES = ['FHO000', 'FHX000'] as const;
type BucketCode = (typeof BUCKET_CODES)[number];

export type AdminExpenseRow = {
  /** Vendor / supplier name. For Bills: `supplierName`. For Expenses:
   *  `vendor` (free text) — falls back to "(unspecified)" when both
   *  the receipt parser and human entry left it blank. */
  vendor: string;
  /** Bucket the line is tagged to. */
  bucket: BucketCode;
  /** Bill or Expense category (travel / meals / subscriptions / …). */
  category: string;
  /** Source row type — drives the link target. */
  source: 'bill' | 'expense';
  /** Source row id for click-through. */
  id: string;
  /** AUD cents, inc GST. */
  amountCents: number;
  /** Status as string (BillStatus / ExpenseStatus collapse to a
   *  shared display value here). */
  status: string;
  /** Issue / receipt date. */
  date: Date;
};

export type AdminExpenseReport = {
  rows: AdminExpenseRow[];
  totals: {
    /** Per-bucket totals across all surfaced rows. */
    perBucket: Record<BucketCode, number>;
    grand: number;
    rowCount: number;
  };
};

/**
 * Roll up bills + expenses tagged to FHO / FHX into a single
 * vendor/amount table. Excludes rejected rows + draft expenses
 * (they're not yet committed firm spend).
 */
export async function computeAdminExpenseReport(): Promise<AdminExpenseReport> {
  // Resolve the bucket project ids so we can filter Bills + Expenses
  // by projectId (not by code; faster + indexed).
  const bucketProjects = await prisma.project.findMany({
    where: { code: { in: [...BUCKET_CODES] } },
    select: { id: true, code: true },
  });
  const codeById = new Map<string, BucketCode>(
    bucketProjects.map((p) => [p.id, p.code as BucketCode]),
  );
  const bucketIds = bucketProjects.map((p) => p.id);
  if (bucketIds.length === 0) {
    return {
      rows: [],
      totals: {
        perBucket: { FHO000: 0, FHX000: 0 },
        grand: 0,
        rowCount: 0,
      },
    };
  }

  const [bills, expenses] = await Promise.all([
    prisma.bill.findMany({
      where: {
        projectId: { in: bucketIds },
        status: {
          in: ['pending_review', 'approved', 'scheduled_for_payment', 'paid'],
        },
      },
      orderBy: { issueDate: 'desc' },
      select: {
        id: true,
        projectId: true,
        supplierName: true,
        amountTotal: true,
        category: true,
        status: true,
        issueDate: true,
      },
    }),
    prisma.expense.findMany({
      where: {
        projectId: { in: bucketIds },
        status: { in: ['submitted', 'approved', 'reimbursed', 'batched_for_payment'] },
      },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        projectId: true,
        vendor: true,
        amount: true,
        category: true,
        status: true,
        date: true,
      },
    }),
  ]);

  const rows: AdminExpenseRow[] = [];
  for (const b of bills) {
    const bucket = codeById.get(b.projectId ?? '');
    if (!bucket) continue;
    rows.push({
      vendor: b.supplierName ?? '(unspecified)',
      bucket,
      category: b.category,
      source: 'bill',
      id: b.id,
      amountCents: b.amountTotal,
      status: b.status,
      date: b.issueDate,
    });
  }
  for (const e of expenses) {
    const bucket = codeById.get(e.projectId ?? '');
    if (!bucket) continue;
    rows.push({
      vendor: e.vendor ?? '(unspecified)',
      bucket,
      category: e.category,
      source: 'expense',
      id: e.id,
      amountCents: e.amount,
      status: e.status,
      date: e.date,
    });
  }
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());

  const perBucket: Record<BucketCode, number> = {
    FHO000: 0,
    FHX000: 0,
  };
  let grand = 0;
  for (const r of rows) {
    perBucket[r.bucket] += r.amountCents;
    grand += r.amountCents;
  }

  return {
    rows,
    totals: { perBucket, grand, rowCount: rows.length },
  };
}
