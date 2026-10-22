import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';

/**
 * TASK-517 — contractor expenses as their OWN invoice, on recharge GST.
 *
 * This file began life as the TASK-509 pass-through suite. D3 and D4 (TT
 * 2026-09-10) put expenses on the fee invoice as a second section and passed
 * their GST through untouched. D7 and D8 (TT 2026-10-23) reversed both:
 *
 *   D7 — expenses are a SEPARATE invoice with their own contractor-supplied
 *        number, raising their own Bill rows.
 *   D8 — RECHARGE, not pass-through. The contractor reclaims the GST they
 *        paid and bills Foundry the net plus 10% of their own.
 *
 * The assertions were rewritten rather than deleted: they encoded the old
 * rule correctly, and the same arithmetic has to be pinned down under the new
 * one. For a standard-rated cost the total is unchanged, which is exactly why
 * a GST-FREE cost is tested explicitly — that is the only case where the two
 * treatments give different money, and so the only case that can tell you
 * which one the code is actually doing.
 *
 * The double-payment guard is unchanged and still under test. An expense on a
 * contractor bill has left the reimbursement float; if it also stays in the
 * reimbursables aging, Foundry is shown owing the same cost twice and someone
 * pays it twice.
 */

const db = vi.hoisted(() => ({
  person: { findUnique: vi.fn() },
  timesheetPeriod: { findUnique: vi.fn(), update: vi.fn() },
  timesheetEntry: { findMany: vi.fn(), updateMany: vi.fn() },
  expense: { findMany: vi.fn(), updateMany: vi.fn() },
  bill: { create: vi.fn(), findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/capabilities', () => ({ requireCapability: vi.fn() }));
vi.mock('@/server/audit', async () => {
  const actual = await vi.importActual<typeof import('@/server/audit')>('@/server/audit');
  return { ...actual, writeAudit: vi.fn() };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const sessionMod = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/server/session', () => sessionMod);

const { confirmContractorInvoice } = await import('@/app/(app)/me/invoices/actions');

const CONTRACTOR: Session = {
  person: {
    id: 'p1',
    email: 'jas.navarro@foundry.health',
    firstName: 'Jas',
    lastName: 'Navarro',
    initials: 'JN',
    roles: ['staff'] as Session['person']['roles'],
    headshotUrl: null,
    band: 'Consultant' as Session['person']['band'],
  },
  realRoles: ['staff'] as Session['realRoles'],
  isRealSuperAdmin: false,
  viewAsRoles: null,
};

function confirmForm(): FormData {
  const fd = new FormData();
  fd.set('personId', 'p1');
  fd.set('year', '2026');
  fd.set('month', '8');
  fd.set('contractorInvoiceNumber', 'JN-0042');
  // D7: expenses are their own document, so their own number.
  fd.set('expenseInvoiceNumber', 'JN-0043');
  return fd;
}

const RATE = 22_000; // $220/h in cents

beforeEach(() => {
  vi.clearAllMocks();
  // TASK-517: both numbers are collision-checked before anything is written.
  db.bill.findFirst.mockResolvedValue(null);
  sessionMod.getSession.mockResolvedValue(CONTRACTOR);
  db.person.findUnique.mockResolvedValue({
    id: 'p1',
    firstName: 'Jas',
    lastName: 'Navarro',
    employment: 'contractor',
    rate: RATE,
  });
  db.timesheetPeriod.findUnique.mockResolvedValue({
    id: 'per1',
    personId: 'p1',
    year: 2026,
    month: 8,
    state: 'approved',
    draftRateCents: RATE,
  });
  db.timesheetEntry.findMany.mockResolvedValue([
    { id: 'te1', projectId: 'proj1', hours: 10, project: { code: 'CAC001' } },
  ]);
  db.expense.findMany.mockResolvedValue([]);
  db.bill.create.mockResolvedValue({ id: 'bill-1' });
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => Promise<unknown>) => fn(db));
});

describe('GST — both legs add the contractor’s own', () => {
  it('adds 10% to fees when there are no expenses', async () => {
    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    const bill = db.bill.create.mock.calls[0]![0].data;
    expect(bill.amountTotal).toBe(220_000 + 22_000);
    expect(bill.gst).toBe(22_000);
  });

  it('puts expenses on their own bill, never on the fee bill', async () => {
    // A$440 flight, GST-inclusive, $40 of which is GST.
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 4_000, projectId: 'proj1', project: { code: 'CAC001' } },
    ]);
    db.bill.create
      .mockResolvedValueOnce({ id: 'bill-fees' })
      .mockResolvedValueOnce({ id: 'bill-exp' });

    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    const bills = db.bill.create.mock.calls.map((c) => c[0].data);
    expect(bills).toHaveLength(2);

    const fees = bills.find((b) => b.category === 'Contractor — services')!;
    const exp = bills.find((b) => b.category === 'Contractor — expenses')!;

    // The fee bill is time only. Any expense on it means D7 didn't happen.
    expect(fees.amountTotal).toBe(220_000 + 22_000);
    expect(fees.gst).toBe(22_000);
    expect(fees.supplierInvoiceNumber).toBe('JN-0042');

    // Recharge: net 40,000 + the contractor's own 4,000 GST.
    expect(exp.amountTotal).toBe(40_000 + 4_000);
    expect(exp.gst).toBe(4_000);
    expect(exp.supplierInvoiceNumber).toBe('JN-0043');
  });

  it('grosses up a GST-FREE cost — the case where recharge and pass-through differ', async () => {
    // An overseas flight: A$440 paid, no GST in it to reclaim.
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 0, projectId: 'proj1', project: { code: 'CAC001' } },
    ]);
    db.bill.create
      .mockResolvedValueOnce({ id: 'bill-fees' })
      .mockResolvedValueOnce({ id: 'bill-exp' });

    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    const exp = db.bill.create.mock.calls
      .map((c) => c[0].data)
      .find((b) => b.category === 'Contractor — expenses')!;

    // Net is the whole 44,000 — nothing was reclaimable — so 10% goes on top
    // and Foundry pays more than the contractor did. That is correct for a
    // recharge: the supply to Foundry is the contractor's taxable supply.
    expect(exp.amountTotal).toBe(44_000 + 4_400);
    expect(exp.gst).toBe(4_400);
    // The old pass-through answer, now wrong:
    expect(exp.amountTotal).not.toBe(44_000);
  });

  it('records the treatment on the audit event so the arithmetic is explicable later', async () => {
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 4_000, projectId: 'proj1', project: { code: 'CAC001' } },
    ]);
    db.bill.create
      .mockResolvedValueOnce({ id: 'bill-fees' })
      .mockResolvedValueOnce({ id: 'bill-exp' });
    const audit = await import('@/server/audit');

    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    const after = vi
      .mocked(audit.writeAudit)
      .mock.calls.map((c) => c[1].entity.after!)
      .find((a) => a.leg === 'expenses')!;
    expect(after.expenseTreatment).toBe('recharge_contractor_adds_own_gst');
    // What they paid, and the GST inside it that THEY now reclaim...
    expect(after.paidIncGstCents).toBe(44_000);
    expect(after.gstWithinPaidCents).toBe(4_000);
    // ...versus what they bill Foundry.
    expect(after.expensesExGstCents).toBe(40_000);
    expect(after.expenseGstCents).toBe(4_000);
  });

  it('refuses expenses without their own invoice number', async () => {
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 4_000, projectId: 'proj1', project: { code: 'CAC001' } },
    ]);
    const fd = confirmForm();
    fd.set('expenseInvoiceNumber', '');

    const res = await confirmContractorInvoice({ status: 'idle' }, fd);

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('expense invoice number');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('refuses the same number on both documents', async () => {
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 4_000, projectId: 'proj1', project: { code: 'CAC001' } },
    ]);
    const fd = confirmForm();
    fd.set('expenseInvoiceNumber', 'JN-0042');

    const res = await confirmContractorInvoice({ status: 'idle' }, fd);

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('different numbers');
    expect(db.bill.create).not.toHaveBeenCalled();
  });
});

describe('double-payment guard', () => {
  it('links the expense to the bill so it leaves the reimbursement float', async () => {
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 4_000, projectId: 'proj1', project: { code: 'CAC001' } },
    ]);

    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    expect(db.expense.updateMany).toHaveBeenCalledTimes(1);
    const call = db.expense.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ id: { in: ['ex1'] } });
    expect(call.data).toEqual({ contractorBillId: 'bill-1' });
    // The AR leg is not this flow's to touch — the client recharge is a
    // separate, legitimate leg (TASK-500's two-leg rule).
    expect(call.data).not.toHaveProperty('rebilledOnInvoiceId');
    expect(call.data).not.toHaveProperty('rebillable');
    expect(call.data).not.toHaveProperty('status');
  });

  it('only picks up approved, unlinked, project-tagged expenses', async () => {
    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    expect(db.expense.findMany.mock.calls[0]![0].where).toEqual({
      personId: 'p1',
      date: { gte: expect.any(Date), lt: expect.any(Date) },
      status: 'approved',
      contractorBillId: null,
      projectId: { not: null },
    });
  });
});

describe('grouping', () => {
  it('splits by project AND by document — one bill per project per invoice', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      { id: 'te1', projectId: 'proj1', hours: 10, project: { code: 'CAC001' } },
      { id: 'te2', projectId: 'proj2', hours: 5, project: { code: 'CAC002' } },
    ]);
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 4_000, projectId: 'proj2', project: { code: 'CAC002' } },
    ]);
    db.bill.create
      .mockResolvedValueOnce({ id: 'bill-1' })
      .mockResolvedValueOnce({ id: 'bill-2' })
      .mockResolvedValueOnce({ id: 'bill-3' });

    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    const bills = db.bill.create.mock.calls.map((c) => c[0].data);
    // Two projects on the fee invoice, one of them also on the expense
    // invoice: three bills, not two.
    expect(bills).toHaveLength(3);

    const fees = bills.filter((b) => b.category === 'Contractor — services');
    const exps = bills.filter((b) => b.category === 'Contractor — expenses');
    expect(fees.map((b) => b.projectId).sort()).toEqual(['proj1', 'proj2']);
    expect(exps.map((b) => b.projectId)).toEqual(['proj2']);

    // Fee bills are time only — proj2's expense is NOT folded into its fees.
    expect(fees.find((b) => b.projectId === 'proj1')!.amountTotal).toBe(220_000 + 22_000);
    expect(fees.find((b) => b.projectId === 'proj2')!.amountTotal).toBe(110_000 + 11_000);
    // Recharged net plus the contractor's own GST, on its own document.
    expect(exps[0]!.amountTotal).toBe(40_000 + 4_000);

    // Each document carries its own number, and every bill on a document
    // carries that document's number.
    for (const b of fees) expect(b.supplierInvoiceNumber).toBe('JN-0042');
    for (const b of exps) expect(b.supplierInvoiceNumber).toBe('JN-0043');
  });

  it('raises a bill for a project that has only expenses and no hours', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      { id: 'te1', projectId: 'proj1', hours: 10, project: { code: 'CAC001' } },
    ]);
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 4_000, projectId: 'proj2', project: { code: 'CAC002' } },
    ]);
    db.bill.create
      .mockResolvedValueOnce({ id: 'bill-1' })
      .mockResolvedValueOnce({ id: 'bill-2' });

    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    const p2 = db.bill.create.mock.calls
      .map((c) => c[0].data)
      .find((b) => b.projectId === 'proj2')!;
    // Zero fees, so zero fee GST; the whole bill is the pass-through.
    expect(p2.amountTotal).toBe(44_000);
    expect(p2.gst).toBe(4_000);
  });

  it('refuses when both hours and expenses are already billed', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]);
    db.expense.findMany.mockResolvedValue([]);

    const res = await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('Nothing left to invoice');
    expect(db.bill.create).not.toHaveBeenCalled();
  });
});

// ─── The reimbursement side of the guard ────────────────────────────────────

describe('reimbursables aging excludes anything already on a contractor bill', () => {
  it('filters on contractorBillId: null', async () => {
    vi.resetModules();
    const aging = vi.hoisted(() => ({ expense: { findMany: vi.fn() } }));
    vi.doMock('@/server/db', () => ({ prisma: aging }));
    aging.expense.findMany.mockResolvedValue([]);

    const { computeFirmReimbursementsAging } = await import(
      '@/server/reports/reimbursements-aging'
    );
    await computeFirmReimbursementsAging();

    const where = aging.expense.findMany.mock.calls[0]![0].where;
    // Without this, an expense being paid through the contractor's invoice
    // still shows as money Foundry owes, and gets paid a second time.
    expect(where.contractorBillId).toBeNull();
    expect(where.status.in).toEqual(['submitted', 'approved', 'batched_for_payment']);
  });
});
