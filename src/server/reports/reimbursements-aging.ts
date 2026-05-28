import type { ExpenseStatus } from '@prisma/client';
import { prisma } from '@/server/db';

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';
export type AgingKey = AgingBucket | 'not_due';

export type AgedReimbursement = {
  id: string;
  personId: string;
  personName: string;
  personInitials: string;
  vendor: string | null;
  description: string | null;
  category: string;
  date: Date; // expense date — proxy for "incurred" (Expense rows have no due date)
  /**
   * Days since the expense was *approved*. Reimbursables don't have a
   * formal due date — we use approval age as the proxy because that's the
   * staff member's expectation: "I was approved N days ago, when do I get
   * paid?" A 14-day pay-cycle convention is reasonable so anything past
   * 14d shows as "overdue".
   */
  daysOutstanding: number;
  bucket: AgingKey;
  amountTotalCents: number; // inc GST — total reimbursement
  gstCents: number;
  status: ExpenseStatus;
  rebillable: boolean;
  rebilledOnInvoiceId: string | null;
  project: { id: string; code: string; name: string } | null;
};

export type PersonReimbursementsAging = {
  personId: string;
  personName: string;
  personInitials: string;
  totalOutstandingCents: number;
  bucketCents: Record<AgingKey, number>;
  rows: AgedReimbursement[];
};

export type FirmReimbursementsAging = {
  totalOutstandingCents: number;
  bucketTotals: Record<AgingKey, number>;
  rowCount: number;
  oldestOutstandingDays: number | null;
  byPerson: PersonReimbursementsAging[];
  /** Rebillable items not yet forwarded to a client invoice — pass-through cash. */
  rebillablePendingCents: number;
  rebillablePendingCount: number;
};

const OPEN_STATUSES: ExpenseStatus[] = [
  'submitted',
  'approved',
  'batched_for_payment',
];

/** 14-day reimbursement cycle convention — anything older counts as overdue. */
const PAY_CYCLE_DAYS = 14;

function bucketForDays(days: number): AgingKey {
  // `days` here is how long Foundry has owed the reimbursement, measured
  // from the expense date. We slide the buckets so the first PAY_CYCLE_DAYS
  // is "not_due" — staff reasonably expect to wait one cycle.
  const overdue = days - PAY_CYCLE_DAYS;
  if (overdue < 0) return 'not_due';
  if (overdue <= 30) return '0-30';
  if (overdue <= 60) return '31-60';
  if (overdue <= 90) return '61-90';
  return '90+';
}

/**
 * Reimbursables aging — Expense rows where Foundry still owes a staff
 * member. Mirrors AP aging in shape (so the UI can reuse the bucket
 * styling) but tracks individual reimbursements rather than vendor bills.
 *
 * Open = submitted / approved / batched_for_payment. Reimbursed/paid is
 * out of scope. Rejected and draft are excluded.
 */
export async function computeFirmReimbursementsAging(): Promise<FirmReimbursementsAging> {
  const expenses = await prisma.expense.findMany({
    where: { status: { in: OPEN_STATUSES } },
    orderBy: { date: 'asc' },
    include: {
      person: {
        select: { id: true, firstName: true, lastName: true, initials: true },
      },
      project: { select: { id: true, code: true, name: true } },
    },
  });

  const now = Date.now();
  const MS_PER_DAY = 24 * 3600 * 1000;

  const aged: AgedReimbursement[] = expenses.map((e) => {
    const days = Math.floor((now - e.date.getTime()) / MS_PER_DAY);
    return {
      id: e.id,
      personId: e.person.id,
      personName: `${e.person.firstName} ${e.person.lastName}`,
      personInitials: e.person.initials,
      vendor: e.vendor,
      description: e.description,
      category: e.category,
      date: e.date,
      daysOutstanding: days,
      bucket: bucketForDays(days),
      amountTotalCents: e.amount, // Expense.amount is inc-GST
      gstCents: e.gst,
      status: e.status,
      rebillable: e.rebillable,
      rebilledOnInvoiceId: e.rebilledOnInvoiceId,
      project: e.project,
    };
  });

  const bucketTotals: Record<AgingKey, number> = {
    not_due: 0,
    '0-30': 0,
    '31-60': 0,
    '61-90': 0,
    '90+': 0,
  };
  let oldestOutstandingDays: number | null = null;
  let rebillablePendingCents = 0;
  let rebillablePendingCount = 0;
  for (const r of aged) {
    bucketTotals[r.bucket] += r.amountTotalCents;
    const overdue = r.daysOutstanding - PAY_CYCLE_DAYS;
    if (overdue > 0 && (oldestOutstandingDays === null || overdue > oldestOutstandingDays)) {
      oldestOutstandingDays = overdue;
    }
    if (r.rebillable && !r.rebilledOnInvoiceId) {
      rebillablePendingCents += r.amountTotalCents;
      rebillablePendingCount += 1;
    }
  }

  const totalOutstanding = aged.reduce((s, r) => s + r.amountTotalCents, 0);

  // Group by person — that's how AP teams pay reimbursements out (one ABA
  // line per person, summing all of their open expenses for the cycle).
  const grouped = new Map<string, PersonReimbursementsAging>();
  for (const r of aged) {
    const row =
      grouped.get(r.personId) ??
      ({
        personId: r.personId,
        personName: r.personName,
        personInitials: r.personInitials,
        totalOutstandingCents: 0,
        bucketCents: {
          not_due: 0,
          '0-30': 0,
          '31-60': 0,
          '61-90': 0,
          '90+': 0,
        } as Record<AgingKey, number>,
        rows: [] as AgedReimbursement[],
      } as PersonReimbursementsAging);
    row.totalOutstandingCents += r.amountTotalCents;
    row.bucketCents[r.bucket] += r.amountTotalCents;
    row.rows.push(r);
    grouped.set(r.personId, row);
  }

  const byPerson = [...grouped.values()]
    .map((p) => ({
      ...p,
      rows: [...p.rows].sort((a, b) => b.daysOutstanding - a.daysOutstanding),
    }))
    .sort((a, b) => b.totalOutstandingCents - a.totalOutstandingCents);

  return {
    totalOutstandingCents: totalOutstanding,
    bucketTotals,
    rowCount: aged.length,
    oldestOutstandingDays,
    byPerson,
    rebillablePendingCents,
    rebillablePendingCount,
  };
}
