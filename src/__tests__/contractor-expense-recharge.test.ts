import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';

/**
 * TASK-509 — contractor expenses on the period invoice.
 *
 * D3 (TT 2026-09-10): one invoice, expenses as their own section, PASS-THROUGH
 * GST treatment. The contractor invoices the full GST-inclusive amount they
 * paid and adds no GST of their own on those lines; Foundry reclaims the
 * input credit. Fee lines are the opposite: GST is added on top of hours ×
 * rate. Getting that backwards charges GST twice on every expense.
 *
 * The other thing under test is the double-payment guard. An expense on a
 * contractor bill has left the reimbursement float; if it also stays in the
 * reimbursables aging, Foundry is shown owing the same cost twice and someone
 * pays it twice.
 */

const db = vi.hoisted(() => ({
  person: { findUnique: vi.fn() },
  timesheetPeriod: { findUnique: vi.fn(), update: vi.fn() },
  timesheetEntry: { findMany: vi.fn(), updateMany: vi.fn() },
  expense: { findMany: vi.fn(), updateMany: vi.fn() },
  bill: { create: vi.fn() },
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
  return fd;
}

const RATE = 22_000; // $220/h in cents

beforeEach(() => {
  vi.clearAllMocks();
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

describe('GST — fees add it, expenses pass it through', () => {
  it('adds 10% to fees when there are no expenses', async () => {
    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    const bill = db.bill.create.mock.calls[0]![0].data;
    expect(bill.amountTotal).toBe(220_000 + 22_000);
    expect(bill.gst).toBe(22_000);
  });

  it('passes an expense through at cost and does NOT re-charge GST on it', async () => {
    // A$440 flight, GST-inclusive, $40 of which is GST.
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 4_000, projectId: 'proj1', project: { code: 'CAC001' } },
    ]);

    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    const bill = db.bill.create.mock.calls[0]![0].data;
    // Fees 220,000 + fee GST 22,000 + expense 44,000 inclusive.
    expect(bill.amountTotal).toBe(220_000 + 22_000 + 44_000);
    // Reclaimable GST = 22,000 on fees + the 4,000 already inside the expense.
    expect(bill.gst).toBe(22_000 + 4_000);
    // The wrong answer, if GST were added on top of the expense line:
    expect(bill.amountTotal).not.toBe(220_000 + 22_000 + 44_000 + 4_400);
  });

  it('records the treatment on the audit event so the arithmetic is explicable later', async () => {
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 4_000, projectId: 'proj1', project: { code: 'CAC001' } },
    ]);
    const audit = await import('@/server/audit');

    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    const after = vi.mocked(audit.writeAudit).mock.calls[0]![1].entity.after!;
    expect(after.expenseTreatment).toBe('pass_through_contractor_adds_no_gst');
    expect(after.expenseTotalCentsIncGst).toBe(44_000);
    expect(after.expenseGstCentsReclaimable).toBe(4_000);
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
  it('puts each expense on its own project bill', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      { id: 'te1', projectId: 'proj1', hours: 10, project: { code: 'CAC001' } },
      { id: 'te2', projectId: 'proj2', hours: 5, project: { code: 'CAC002' } },
    ]);
    db.expense.findMany.mockResolvedValue([
      { id: 'ex1', amount: 44_000, gst: 4_000, projectId: 'proj2', project: { code: 'CAC002' } },
    ]);
    db.bill.create
      .mockResolvedValueOnce({ id: 'bill-1' })
      .mockResolvedValueOnce({ id: 'bill-2' });

    await confirmContractorInvoice({ status: 'idle' }, confirmForm());

    const bills = db.bill.create.mock.calls.map((c) => c[0].data);
    const p1 = bills.find((b) => b.projectId === 'proj1')!;
    const p2 = bills.find((b) => b.projectId === 'proj2')!;
    expect(p1.amountTotal).toBe(220_000 + 22_000); // no expense on this one
    expect(p2.amountTotal).toBe(110_000 + 11_000 + 44_000);
    // Both bills carry the contractor's single invoice number.
    expect(p1.supplierInvoiceNumber).toBe('JN-0042');
    expect(p2.supplierInvoiceNumber).toBe('JN-0042');
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
