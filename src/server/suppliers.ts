import { prisma } from '@/server/db';

export type SupplierProfile = {
  id: string;
  name: string;
  legalName: string | null;
  abn: string | null;
  acn: string | null;
  website: string | null;
  domain: string | null;
  logoUrl: string | null;
  supplierType: string;
  contactEmail: string | null;
  contactPhone: string | null;
};

export type SupplierListRow = {
  name: string;
  billCount: number;
  totalPaidCents: number; // sum of amountTotal across approved+ bills
  lastBillDate: Date | null;
  categories: string[]; // distinct categories they've billed under
  unpaidCents: number; // approved or scheduled but not yet paid
  /** Resolved company-logo URL (Clearbit). Null when no Supplier row
   *  exists for this name yet, or when the operator hasn't set a
   *  website. Frontend should still render a fallback. */
  logoUrl: string | null;
  website: string | null;
};

/**
 * Suppliers are external orgs that don't have a Person row — they appear on
 * Bills via `supplierName` with `supplierPersonId` null. This returns a
 * grouped summary: one row per distinct supplierName, with totals + categories
 * + last-bill date. Contractor-person suppliers are handled on /directory/
 * contractors instead.
 *
 * Where a Supplier row exists for the name (i.e. the operator has filled
 * in website / ABN), we splat in `logoUrl` + `website` so the list page
 * can render the company logo.
 */
export async function listSuppliers(): Promise<SupplierListRow[]> {
  const [bills, profiles] = await Promise.all([
    prisma.bill.findMany({
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
    }),
    prisma.supplier.findMany({
      select: { name: true, website: true, logoUrl: true },
    }),
  ]);

  const profileByName = new Map(profiles.map((p) => [p.name, p]));

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
        logoUrl: profileByName.get(name)?.logoUrl ?? null,
        website: profileByName.get(name)?.website ?? null,
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

  // Include profile-only suppliers (operator added an ABN / website
  // before any bills landed). Surface them with zero totals so admin
  // can see the company exists in the directory.
  for (const p of profiles) {
    if (!grouped.has(p.name)) {
      grouped.set(p.name, {
        name: p.name,
        billCount: 0,
        totalPaidCents: 0,
        lastBillDate: null,
        categories: [],
        unpaidCents: 0,
        logoUrl: p.logoUrl,
        website: p.website,
      });
    }
  }

  return [...grouped.values()].sort((a, b) => b.totalPaidCents - a.totalPaidCents);
}

export type SupplierBillRow = {
  id: string;
  supplierInvoiceNumber: string | null;
  issueDate: Date;
  dueDate: Date;
  amountTotalCents: number;
  gstCents: number;
  category: string;
  status: string;
  project: { code: string; name: string } | null;
  xeroBillId: string | null;
};

export type SupplierDetail = {
  name: string;
  profile: SupplierProfile | null;
  totals: {
    billCount: number;
    paidCents: number;
    unpaidCents: number;
    pendingReviewCents: number;
    lifetimeGrossCents: number; // all non-rejected bills, for shape of spend
  };
  categoryBreakdown: Array<{ category: string; count: number; grossCents: number }>;
  bills: SupplierBillRow[];
};

/**
 * Full bill history + structured profile for a single external supplier.
 * Supplier is identified by name. Returns null when neither a Bill row
 * nor a Supplier profile exists under that name.
 */
export async function getSupplierByName(name: string): Promise<SupplierDetail | null> {
  const [profile, bills] = await Promise.all([
    prisma.supplier.findUnique({
      where: { name },
      select: {
        id: true,
        name: true,
        legalName: true,
        abn: true,
        acn: true,
        website: true,
        domain: true,
        logoUrl: true,
        supplierType: true,
        contactEmail: true,
        contactPhone: true,
      },
    }),
    prisma.bill.findMany({
      where: {
        supplierPersonId: null,
        supplierName: name,
        status: { in: ['pending_review', 'approved', 'scheduled_for_payment', 'paid', 'rejected'] },
      },
      orderBy: { issueDate: 'desc' },
      select: {
        id: true,
        supplierInvoiceNumber: true,
        issueDate: true,
        dueDate: true,
        amountTotal: true,
        gst: true,
        category: true,
        status: true,
        xeroBillId: true,
        project: { select: { code: true, name: true } },
      },
    }),
  ]);

  // Pre-supplier-table bills can exist without a profile; profile-only
  // entries (operator added website before any bills) are also valid.
  if (!profile && bills.length === 0) return null;

  const totals = bills.reduce(
    (acc, b) => {
      acc.billCount += 1;
      if (b.status !== 'rejected') acc.lifetimeGrossCents += b.amountTotal;
      if (b.status === 'paid') acc.paidCents += b.amountTotal;
      if (b.status === 'approved' || b.status === 'scheduled_for_payment')
        acc.unpaidCents += b.amountTotal;
      if (b.status === 'pending_review') acc.pendingReviewCents += b.amountTotal;
      return acc;
    },
    { billCount: 0, paidCents: 0, unpaidCents: 0, pendingReviewCents: 0, lifetimeGrossCents: 0 },
  );

  const categoryMap = new Map<string, { count: number; grossCents: number }>();
  for (const b of bills) {
    if (b.status === 'rejected') continue;
    const cur = categoryMap.get(b.category) ?? { count: 0, grossCents: 0 };
    cur.count += 1;
    cur.grossCents += b.amountTotal;
    categoryMap.set(b.category, cur);
  }

  return {
    name,
    profile,
    totals,
    categoryBreakdown: [...categoryMap.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.grossCents - a.grossCents),
    bills: bills.map((b) => ({
      id: b.id,
      supplierInvoiceNumber: b.supplierInvoiceNumber,
      issueDate: b.issueDate,
      dueDate: b.dueDate,
      amountTotalCents: b.amountTotal,
      gstCents: b.gst,
      category: b.category,
      status: b.status,
      project: b.project ? { code: b.project.code, name: b.project.name } : null,
      xeroBillId: b.xeroBillId,
    })),
  };
}
