import type { BillStatus } from '@prisma/client';
import { prisma } from '@/server/db';

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';
export type AgingKey = AgingBucket | 'not_due';

export type AgedBill = {
  id: string;
  supplierName: string;
  supplierPersonId: string | null;
  supplierInvoiceNumber: string | null;
  issueDate: Date;
  dueDate: Date;
  amountTotalCents: number;
  category: string;
  status: string;
  daysOverdue: number;
  bucket: AgingKey;
  project: { code: string; name: string } | null;
};

export type SupplierAging = {
  key: string; // supplierPersonId when present, else name
  supplierName: string;
  supplierPersonId: string | null;
  totalOutstandingCents: number;
  bucketCents: Record<AgingKey, number>;
  bills: AgedBill[];
};

export type FirmApAging = {
  totalOutstandingCents: number;
  bucketTotals: Record<AgingKey, number>;
  billCount: number;
  oldestOverdueDays: number | null;
  bySupplier: SupplierAging[];
};

const OPEN_STATUSES: BillStatus[] = ['approved', 'scheduled_for_payment'];

function bucketForDays(days: number): AgingKey {
  if (days < 0) return 'not_due';
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/**
 * AP aging — approved or scheduled bills Foundry still owes, bucketed by days
 * past due. "Paid" bills are out of scope (they're done). "Pending review"
 * hasn't been approved yet so doesn't count as a payable either.
 *
 * Outstanding is Bill.amountTotal (inc GST) — bills are single-line and don't
 * track partial payments at the schema level yet.
 */
export async function computeFirmApAging(): Promise<FirmApAging> {
  const bills = await prisma.bill.findMany({
    where: { status: { in: OPEN_STATUSES } },
    orderBy: { dueDate: 'asc' },
    include: {
      project: { select: { code: true, name: true } },
    },
  });

  const now = Date.now();
  const MS_PER_DAY = 24 * 3600 * 1000;

  const aged: AgedBill[] = bills.map((b) => {
    const daysOverdue = Math.floor((now - b.dueDate.getTime()) / MS_PER_DAY);
    return {
      id: b.id,
      supplierName: b.supplierName ?? 'Unnamed supplier',
      supplierPersonId: b.supplierPersonId,
      supplierInvoiceNumber: b.supplierInvoiceNumber,
      issueDate: b.issueDate,
      dueDate: b.dueDate,
      amountTotalCents: b.amountTotal,
      category: b.category,
      status: b.status,
      daysOverdue,
      bucket: bucketForDays(daysOverdue),
      project: b.project ? { code: b.project.code, name: b.project.name } : null,
    };
  });

  const bucketTotals: Record<AgingKey, number> = {
    not_due: 0,
    '0-30': 0,
    '31-60': 0,
    '61-90': 0,
    '90+': 0,
  };
  let oldestOverdueDays: number | null = null;
  for (const b of aged) {
    bucketTotals[b.bucket] += b.amountTotalCents;
    if (b.daysOverdue > 0 && (oldestOverdueDays === null || b.daysOverdue > oldestOverdueDays)) {
      oldestOverdueDays = b.daysOverdue;
    }
  }

  const totalOutstanding = aged.reduce((s, b) => s + b.amountTotalCents, 0);

  // Group by supplier — Person-backed bills by personId, free-text by name.
  const grouped = new Map<string, SupplierAging>();
  for (const b of aged) {
    const key = b.supplierPersonId ?? `name:${b.supplierName}`;
    const row =
      grouped.get(key) ??
      ({
        key,
        supplierName: b.supplierName,
        supplierPersonId: b.supplierPersonId,
        totalOutstandingCents: 0,
        bucketCents: {
          not_due: 0,
          '0-30': 0,
          '31-60': 0,
          '61-90': 0,
          '90+': 0,
        } as Record<AgingKey, number>,
        bills: [] as AgedBill[],
      } as SupplierAging);
    row.totalOutstandingCents += b.amountTotalCents;
    row.bucketCents[b.bucket] += b.amountTotalCents;
    row.bills.push(b);
    grouped.set(key, row);
  }

  const bySupplier = [...grouped.values()]
    .map((s) => ({
      ...s,
      bills: [...s.bills].sort((a, b) => b.daysOverdue - a.daysOverdue),
    }))
    .sort((a, b) => b.totalOutstandingCents - a.totalOutstandingCents);

  return {
    totalOutstandingCents: totalOutstanding,
    bucketTotals,
    billCount: aged.length,
    oldestOverdueDays,
    bySupplier,
  };
}
