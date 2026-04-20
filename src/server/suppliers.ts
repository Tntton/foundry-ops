import { prisma } from '@/server/db';

export type SupplierListRow = {
  name: string;
  billCount: number;
  totalPaidCents: number; // sum of amountTotal across approved+ bills
  lastBillDate: Date | null;
  categories: string[]; // distinct categories they've billed under
  unpaidCents: number; // approved or scheduled but not yet paid
};

/**
 * Suppliers are external orgs that don't have a Person row — they appear on
 * Bills via `supplierName` with `supplierPersonId` null. This returns a
 * grouped summary: one row per distinct supplierName, with totals + categories
 * + last-bill date. Contractor-person suppliers are handled on /directory/
 * contractors instead.
 */
export async function listSuppliers(): Promise<SupplierListRow[]> {
  const bills = await prisma.bill.findMany({
    where: {
      supplierPersonId: null,
      supplierName: { not: null },
      // Only count bills that are actually live (exclude rejected).
      status: { in: ['pending_review', 'approved', 'scheduled_for_payment', 'paid'] },
    },
    select: {
      supplierName: true,
      amountTotal: true,
      category: true,
      status: true,
      issueDate: true,
    },
  });

  const grouped = new Map<string, SupplierListRow>();
  for (const b of bills) {
    const name = b.supplierName!;
    const cur =
      grouped.get(name) ??
      ({
        name,
        billCount: 0,
        totalPaidCents: 0,
        lastBillDate: null,
        categories: [],
        unpaidCents: 0,
      } satisfies SupplierListRow);

    cur.billCount += 1;
    if (b.status === 'paid') cur.totalPaidCents += b.amountTotal;
    if (b.status === 'approved' || b.status === 'scheduled_for_payment') {
      cur.unpaidCents += b.amountTotal;
    }
    if (!cur.lastBillDate || b.issueDate > cur.lastBillDate) cur.lastBillDate = b.issueDate;
    if (!cur.categories.includes(b.category)) cur.categories.push(b.category);

    grouped.set(name, cur);
  }

  return [...grouped.values()].sort((a, b) => b.totalPaidCents - a.totalPaidCents);
}
