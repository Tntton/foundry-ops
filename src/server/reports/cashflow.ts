import { prisma } from '@/server/db';

export type CashflowBucket = {
  label: string; // ISO date of Monday that starts the bucket
  rangeStart: Date;
  rangeEnd: Date; // exclusive
  arExpectedCents: number;
  apDueCents: number;
  netCents: number;
  overdueAr?: boolean;
  overdueAp?: boolean;
};

export type CashflowForecast = {
  buckets: CashflowBucket[];
  totals: {
    arExpectedCents: number;
    apDueCents: number;
    netCents: number;
    arOverdueCents: number; // open invoices already past due (past bucket)
    apOverdueCents: number;
  };
  horizonWeeks: number;
};

function startOfMondayUtc(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return m;
}

/**
 * 12-week forward-looking cash forecast: buckets open AR by due date on the
 * collection side, and open AP (approved + scheduled, not paid yet) on the
 * payment side. Rows for due-dates already past today go in an "overdue"
 * first bucket so they show up for chase/pay instead of falling off the end.
 */
export async function computeCashflow(weeks = 12): Promise<CashflowForecast> {
  const now = new Date();
  const thisMonday = startOfMondayUtc(now);
  const horizonEnd = new Date(
    thisMonday.getTime() + weeks * 7 * 24 * 3600 * 1000,
  );

  const [invoices, bills] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        status: { in: ['approved', 'sent', 'partial', 'overdue'] },
      },
      select: {
        amountTotal: true,
        paymentReceivedAmount: true,
        dueDate: true,
      },
    }),
    prisma.bill.findMany({
      where: { status: { in: ['approved', 'scheduled_for_payment'] } },
      select: { amountTotal: true, dueDate: true },
    }),
  ]);

  const buckets: CashflowBucket[] = [];
  // First bucket: overdue (dueDate < this Monday).
  buckets.push({
    label: 'Overdue',
    rangeStart: new Date(0),
    rangeEnd: thisMonday,
    arExpectedCents: 0,
    apDueCents: 0,
    netCents: 0,
    overdueAr: true,
    overdueAp: true,
  });
  for (let i = 0; i < weeks; i++) {
    const start = new Date(thisMonday.getTime() + i * 7 * 24 * 3600 * 1000);
    const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
    buckets.push({
      label: start.toISOString().slice(0, 10),
      rangeStart: start,
      rangeEnd: end,
      arExpectedCents: 0,
      apDueCents: 0,
      netCents: 0,
    });
  }

  function bucketIndexForDueDate(d: Date): number {
    if (d < thisMonday) return 0;
    if (d >= horizonEnd) return -1; // beyond horizon — drop
    const weeksOut = Math.floor(
      (d.getTime() - thisMonday.getTime()) / (7 * 24 * 3600 * 1000),
    );
    return 1 + weeksOut;
  }

  let arOverdue = 0;
  let apOverdue = 0;

  for (const inv of invoices) {
    const outstanding = inv.amountTotal - (inv.paymentReceivedAmount ?? 0);
    if (outstanding <= 0) continue;
    const idx = bucketIndexForDueDate(inv.dueDate);
    if (idx === -1) continue;
    if (idx === 0) arOverdue += outstanding;
    const bucket = buckets[idx];
    if (bucket) bucket.arExpectedCents += outstanding;
  }

  for (const bill of bills) {
    const idx = bucketIndexForDueDate(bill.dueDate);
    if (idx === -1) continue;
    if (idx === 0) apOverdue += bill.amountTotal;
    const bucket = buckets[idx];
    if (bucket) bucket.apDueCents += bill.amountTotal;
  }

  for (const b of buckets) {
    b.netCents = b.arExpectedCents - b.apDueCents;
  }

  const totals = buckets.reduce(
    (acc, b) => ({
      arExpectedCents: acc.arExpectedCents + b.arExpectedCents,
      apDueCents: acc.apDueCents + b.apDueCents,
      netCents: acc.netCents + b.netCents,
    }),
    { arExpectedCents: 0, apDueCents: 0, netCents: 0 },
  );

  return {
    buckets,
    totals: {
      ...totals,
      arOverdueCents: arOverdue,
      apOverdueCents: apOverdue,
    },
    horizonWeeks: weeks,
  };
}
