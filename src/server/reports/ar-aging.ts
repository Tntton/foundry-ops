import type { InvoiceStatus } from '@prisma/client';
import { prisma } from '@/server/db';

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

export type AgedInvoice = {
  id: string;
  number: string;
  status: string;
  issueDate: Date;
  dueDate: Date;
  amountTotalCents: number;
  paidCents: number;
  outstandingCents: number;
  daysOverdue: number; // negative = not yet due
  bucket: AgingBucket | 'not_due';
  client: { id: string; code: string; legalName: string };
  project: { code: string };
};

export type ClientAging = {
  clientId: string;
  code: string;
  legalName: string;
  totalOutstandingCents: number;
  bucketCents: Record<AgingBucket | 'not_due', number>;
  invoices: AgedInvoice[];
};

export type FirmAging = {
  totalOutstandingCents: number;
  bucketTotals: Record<AgingBucket | 'not_due', number>;
  invoiceCount: number;
  oldestOverdueDays: number | null;
  byClient: ClientAging[];
};

const OPEN_STATUSES: InvoiceStatus[] = ['approved', 'sent', 'partial', 'overdue'];

function bucketForDays(days: number): AgingBucket | 'not_due' {
  if (days < 0) return 'not_due';
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/**
 * AR aging across every open invoice. Buckets by days past due relative to
 * today (00:00 UTC). "Open" means invoice.status in approved / sent / partial /
 * overdue — draft and pending_approval don't count as AR. Outstanding =
 * amountTotal (inc GST) − paymentReceivedAmount.
 */
export async function computeFirmAging(): Promise<FirmAging> {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: OPEN_STATUSES } },
    orderBy: { issueDate: 'asc' },
    include: {
      client: { select: { id: true, code: true, legalName: true } },
      project: { select: { code: true } },
    },
  });

  const now = Date.now();
  const MS_PER_DAY = 24 * 3600 * 1000;

  const aged: AgedInvoice[] = invoices.map((inv) => {
    const outstanding = inv.amountTotal - (inv.paymentReceivedAmount ?? 0);
    const daysOverdue = Math.floor((now - inv.dueDate.getTime()) / MS_PER_DAY);
    return {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      amountTotalCents: inv.amountTotal,
      paidCents: inv.paymentReceivedAmount ?? 0,
      outstandingCents: outstanding,
      daysOverdue,
      bucket: bucketForDays(daysOverdue),
      client: inv.client,
      project: inv.project,
    };
  });

  // Filter out invoices with nothing outstanding (e.g. partial-then-paid drift).
  const openAr = aged.filter((i) => i.outstandingCents > 0);

  const bucketTotals: Record<AgingBucket | 'not_due', number> = {
    not_due: 0,
    '0-30': 0,
    '31-60': 0,
    '61-90': 0,
    '90+': 0,
  };
  let oldestOverdueDays: number | null = null;
  for (const inv of openAr) {
    bucketTotals[inv.bucket] += inv.outstandingCents;
    if (inv.daysOverdue > 0) {
      if (oldestOverdueDays === null || inv.daysOverdue > oldestOverdueDays) {
        oldestOverdueDays = inv.daysOverdue;
      }
    }
  }

  const totalOutstanding = openAr.reduce((s, i) => s + i.outstandingCents, 0);

  // Group by client; sort invoices within each by daysOverdue desc.
  const byClientMap = new Map<string, ClientAging>();
  for (const inv of openAr) {
    const key = inv.client.id;
    const row = byClientMap.get(key) ?? {
      clientId: inv.client.id,
      code: inv.client.code,
      legalName: inv.client.legalName,
      totalOutstandingCents: 0,
      bucketCents: {
        not_due: 0,
        '0-30': 0,
        '31-60': 0,
        '61-90': 0,
        '90+': 0,
      } as Record<AgingBucket | 'not_due', number>,
      invoices: [] as AgedInvoice[],
    };
    row.totalOutstandingCents += inv.outstandingCents;
    row.bucketCents[inv.bucket] += inv.outstandingCents;
    row.invoices.push(inv);
    byClientMap.set(key, row);
  }

  const byClient = [...byClientMap.values()]
    .map((c) => ({
      ...c,
      invoices: [...c.invoices].sort((a, b) => b.daysOverdue - a.daysOverdue),
    }))
    .sort((a, b) => b.totalOutstandingCents - a.totalOutstandingCents);

  return {
    totalOutstandingCents: totalOutstanding,
    bucketTotals,
    invoiceCount: openAr.length,
    oldestOverdueDays,
    byClient,
  };
}
