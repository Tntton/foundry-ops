import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TASK-505 — the contractor's own view of their invoicing.
 *
 * Deliberately period-driven, not bill-driven. "Where is my August invoice?"
 * is usually answered by "two of your three leads haven't approved it yet",
 * and a bill-driven list can only ever show the tail of that story.
 *
 * Also covers markPeriodsInvoicedIfFullyBilled, which stops the admin
 * out-of-cycle path from stranding a month at `approved` after its hours have
 * all been billed — the contractor would otherwise be shown an invoice prompt
 * for hours already on a bill.
 */

const db = vi.hoisted(() => ({
  timesheetPeriod: { findMany: vi.fn() },
  timesheetEntry: { findMany: vi.fn() },
  // TASK-509: the invoice now has an expense leg. Default to none so
  // these cases keep testing the hours path in isolation.
  expense: { findMany: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

const { listMyInvoicePeriods, markPeriodsInvoicedIfFullyBilled } = await import(
  '@/server/timesheet'
);

function period(year: number, month: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `per-${year}-${month}`,
    personId: 'p1',
    year,
    month,
    state: 'approved',
    lodgedAt: new Date(),
    approvedAt: new Date(),
    invoicedAt: null,
    contractorBillId: null,
    draftRateCents: 22_000,
    draftHours: 10,
    draftAmountExGstCents: 220_000,
    draftExpenseTotalCents: 0,
    draftExpenseGstCents: 0,
    draftExpenseCount: 0,
    draftPreparedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.expense.findMany.mockResolvedValue([]);
  db.timesheetEntry.findMany.mockResolvedValue([]);
});

describe('listMyInvoicePeriods', () => {
  it('returns nothing at all for a person who has never lodged', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([]);

    expect(await listMyInvoicePeriods('p1')).toEqual([]);
    // No follow-up reads when there's nothing to enrich.
    expect(db.timesheetEntry.findMany).not.toHaveBeenCalled();
  });

  it('shows months still awaiting approval, not just invoiced ones', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([
      period(2026, 9, { state: 'lodged', approvedAt: null, draftRateCents: null,
                        draftHours: null, draftAmountExGstCents: null }),
      period(2026, 8, { state: 'invoiced', invoicedAt: new Date() }),
    ]);

    const rows = await listMyInvoicePeriods('p1');

    expect(rows.map((r) => [r.monthLabel, r.state])).toEqual([
      ['September 2026', 'lodged'],
      ['August 2026', 'invoiced'],
    ]);
  });

  it('surfaces the frozen draft so the confirm screen shows approved figures', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([period(2026, 8)]);

    const rows = await listMyInvoicePeriods('p1');

    expect(rows[0]!.draft).toEqual({
      rateCents: 22_000,
      hours: 10,
      amountExGstCents: 220_000,
      expenseTotalCents: 0,
      expenseGstCents: 0,
      expenseCount: 0,
    });
  });

  it('reports no draft when the month closed without a rate on file', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([
      period(2026, 8, { draftRateCents: null, draftAmountExGstCents: null }),
    ]);

    expect((await listMyInvoicePeriods('p1'))[0]!.draft).toBeNull();
  });

  it('attaches bills to the month their hours fall in, deduped per bill', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([period(2026, 8, { state: 'invoiced' })]);
    const bill = {
      id: 'bill1',
      supplierInvoiceNumber: 'JN-2026-08',
      amountTotal: 242_000,
      status: 'pending_review',
      project: { code: 'CAC001' },
    };
    // Two entries on the SAME bill — the card must not list it twice.
    db.timesheetEntry.findMany.mockResolvedValue([
      { date: new Date(Date.UTC(2026, 7, 3)), contractorBillId: 'bill1', contractorBill: bill },
      { date: new Date(Date.UTC(2026, 7, 4)), contractorBillId: 'bill1', contractorBill: bill },
    ]);

    const rows = await listMyInvoicePeriods('p1');

    expect(rows[0]!.bills).toEqual([
      {
        id: 'bill1',
        projectCode: 'CAC001',
        supplierInvoiceNumber: 'JN-2026-08',
        amountTotal: 242_000,
        status: 'pending_review',
      },
    ]);
  });

  it('keeps a multi-project month’s bills together on one card', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([period(2026, 8, { state: 'invoiced' })]);
    db.timesheetEntry.findMany.mockResolvedValue([
      {
        date: new Date(Date.UTC(2026, 7, 3)),
        contractorBillId: 'bill1',
        contractorBill: { id: 'bill1', supplierInvoiceNumber: 'JN-1', amountTotal: 100,
                          status: 'paid', project: { code: 'CAC001' } },
      },
      {
        date: new Date(Date.UTC(2026, 7, 4)),
        contractorBillId: 'bill2',
        contractorBill: { id: 'bill2', supplierInvoiceNumber: 'JN-1', amountTotal: 200,
                          status: 'pending_review', project: { code: 'CAC002' } },
      },
    ]);

    const rows = await listMyInvoicePeriods('p1');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.bills.map((b) => b.projectCode)).toEqual(['CAC001', 'CAC002']);
  });

  it('does not attribute a bill to the wrong month', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([
      period(2026, 9, { state: 'approved' }),
      period(2026, 8, { state: 'invoiced' }),
    ]);
    db.timesheetEntry.findMany.mockResolvedValue([
      {
        date: new Date(Date.UTC(2026, 7, 31)), // August
        contractorBillId: 'bill1',
        contractorBill: { id: 'bill1', supplierInvoiceNumber: 'JN-1', amountTotal: 100,
                          status: 'paid', project: { code: 'CAC001' } },
      },
    ]);

    const rows = await listMyInvoicePeriods('p1');
    const byMonth = Object.fromEntries(rows.map((r) => [r.monthLabel, r.bills.length]));

    expect(byMonth['August 2026']).toBe(1);
    expect(byMonth['September 2026']).toBe(0);
  });
});

describe('markPeriodsInvoicedIfFullyBilled', () => {
  const tx = {
    timesheetPeriod: { findUnique: vi.fn(), update: vi.fn() },
    timesheetEntry: { count: vi.fn() },
  };
  const NOW = new Date('2026-09-05T00:00:00Z');
  const AUG = [{ year: 2026, month: 8 }];

  beforeEach(() => {
    tx.timesheetPeriod.findUnique.mockReset();
    tx.timesheetPeriod.update.mockReset();
    tx.timesheetEntry.count.mockReset();
  });

  it('closes an approved month once every hour is on a bill', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue({ id: 'per1', state: 'approved' });
    tx.timesheetEntry.count.mockResolvedValue(0);

    await markPeriodsInvoicedIfFullyBilled(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update).toHaveBeenCalledWith({
      where: { id: 'per1' },
      data: { state: 'invoiced', invoicedAt: NOW },
    });
  });

  it('leaves the month open when some hours are still unbilled', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue({ id: 'per1', state: 'approved' });
    tx.timesheetEntry.count.mockResolvedValue(3);

    await markPeriodsInvoicedIfFullyBilled(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update).not.toHaveBeenCalled();
  });

  it('never touches a month that is not yet fully approved', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue({ id: 'per1', state: 'lodged' });

    await markPeriodsInvoicedIfFullyBilled(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetEntry.count).not.toHaveBeenCalled();
    expect(tx.timesheetPeriod.update).not.toHaveBeenCalled();
  });

  it('ignores months the person never lodged', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(null);

    await markPeriodsInvoicedIfFullyBilled(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update).not.toHaveBeenCalled();
  });
});
