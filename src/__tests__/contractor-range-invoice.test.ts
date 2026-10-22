import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';

/**
 * TASK-511 — the contractor's invoice for an arbitrary date range.
 *
 * Sibling of the month path, not a replacement. Two rules carry the whole
 * design and most of these tests:
 *
 *  1. An hour is billable iff `status = 'approved' AND contractorBillId IS
 *     NULL`, set in the same transaction that creates the Bill. That single
 *     condition — not the period state — is what makes double-billing
 *     impossible when an arbitrary window overlaps an invoiced month.
 *
 *  2. Rates resolve PER ENTRY. A range spanning a closed September and an
 *     open October must price September at the rate frozen when it closed.
 *     TASK-504 froze that rate precisely so a later edit to Person.rate
 *     could not reprice a signed-off month; a naive range query that reads
 *     one rate for the whole window reintroduces exactly that bug.
 *
 * D5 (TT 2026-10-23) adds the third: the generate screen is a form. The
 * number is suggested but editable, the dates are the contractor's, and a
 * fee line can be overridden — with the derived figure kept beside it so the
 * difference is explainable.
 */

const db = vi.hoisted(() => ({
  person: { findUnique: vi.fn() },
  timesheetPeriod: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  timesheetEntry: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  expense: { findMany: vi.fn(), updateMany: vi.fn() },
  bill: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
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

const audit = await import('@/server/audit');
const { generateRangeContractorInvoice } = await import(
  '@/app/(app)/me/invoices/actions'
);
const { previewContractorRangeInvoice } = await import('@/server/timesheet');
const { suggestContractorInvoiceNumber, suggestContractorInvoiceNumbers } = await import(
  '@/server/contractor-bills'
);

const SEPT_RATE = 22_000; // $220/h, frozen when September closed
const CURRENT_RATE = 25_000; // $250/h, today's rate

function sessionFor(id: string, roles: string[]): Session {
  return {
    person: {
      id,
      email: `${id}@foundry.health`,
      firstName: 'Jas',
      lastName: 'Navarro',
      initials: 'JN',
      roles: roles as Session['person']['roles'],
      headshotUrl: null,
      band: 'Consultant' as Session['person']['band'],
    },
    realRoles: roles as Session['realRoles'],
    isRealSuperAdmin: roles.includes('super_admin'),
    viewAsRoles: null,
  };
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function entry(
  id: string,
  iso: string,
  hours: number,
  over: Record<string, unknown> = {},
) {
  return {
    id,
    date: d(iso),
    hours,
    status: 'approved',
    contractorBillId: null,
    projectId: 'proj1',
    project: {
      id: 'proj1',
      code: 'CAC001',
      name: 'Galileo',
      manager: { firstName: 'Michael', lastName: 'Roe' },
      primaryPartner: { firstName: 'Chris', lastName: 'Dale' },
    },
    ...over,
  };
}

function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('personId', 'p1');
  fd.set('start', '2026-09-15');
  fd.set('end', '2026-10-14');
  fd.set('contractorInvoiceNumber', 'JN-2026-004');
  // D7: expenses are their own document, so their own number.
  fd.set('expenseInvoiceNumber', 'JN-2026-005');
  fd.set('issueDate', '2026-10-15');
  fd.set('dueDate', '2026-10-29');
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMod.getSession.mockResolvedValue(sessionFor('p1', ['staff']));
  db.person.findUnique.mockResolvedValue({
    id: 'p1',
    firstName: 'Jas',
    lastName: 'Navarro',
    initials: 'JN',
    employment: 'contractor',
    rate: CURRENT_RATE,
  });
  // September closed at $220; October is still open and has no snapshot.
  db.timesheetPeriod.findMany.mockResolvedValue([
    { year: 2026, month: 9, draftRateCents: SEPT_RATE },
    { year: 2026, month: 10, draftRateCents: null },
  ]);
  db.timesheetEntry.findMany.mockResolvedValue([
    entry('te-sep', '2026-09-20', 10),
    entry('te-oct', '2026-10-05', 4),
  ]);
  db.timesheetEntry.count.mockResolvedValue(1); // something still unbilled
  db.expense.findMany.mockResolvedValue([]);
  db.bill.findFirst.mockResolvedValue(null); // number not already used
  db.bill.findMany.mockResolvedValue([]);
  db.bill.create.mockImplementation(async ({ data }: { data: { projectId: string } }) => ({
    id: `bill-${data.projectId}`,
  }));
  db.timesheetPeriod.findUnique.mockResolvedValue({ id: 'per1', state: 'lodged' });
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => Promise<unknown>) =>
    fn(db),
  );
});

describe('rates resolve per entry, not per range', () => {
  it('prices a closed month at its frozen rate and an open one at the current rate', async () => {
    await generateRangeContractorInvoice({ status: 'idle' }, form());

    // 10h in closed September @ $220 + 4h in open October @ $250.
    const expected = 10 * SEPT_RATE + 4 * CURRENT_RATE;
    expect(db.bill.create).toHaveBeenCalledTimes(1);
    const data = db.bill.create.mock.calls[0]![0].data;
    expect(data.amountTotal).toBe(expected + Math.round(expected * 0.1));
  });

  it('does not reprice the closed month when the current rate changes', async () => {
    db.person.findUnique.mockResolvedValue({
      id: 'p1',
      firstName: 'Jas',
      lastName: 'Navarro',
      initials: 'JN',
      employment: 'contractor',
      rate: 99_000, // a big raise, today
    });

    await generateRangeContractorInvoice({ status: 'idle' }, form());

    // September must still be $220/h. Only October moves.
    const expected = 10 * SEPT_RATE + 4 * 99_000;
    const data = db.bill.create.mock.calls[0]![0].data;
    expect(data.amountTotal).toBe(expected + Math.round(expected * 0.1));
  });

  it('records which rate priced which hours', async () => {
    await generateRangeContractorInvoice({ status: 'idle' }, form());

    const written = vi.mocked(audit.writeAudit).mock.calls[0]![1];
    expect(written.entity.after).toMatchObject({
      source: 'contractor_range_invoice',
      hoursByRateCents: { [String(SEPT_RATE)]: 10, [String(CURRENT_RATE)]: 4 },
    });
  });
});

describe('an hour is billed once, whatever the window', () => {
  it('only ever queries approved, unbilled entries', async () => {
    await generateRangeContractorInvoice({ status: 'idle' }, form());

    const where = db.timesheetEntry.findMany.mock.calls.at(-1)![0].where;
    expect(where).toMatchObject({ status: 'approved', contractorBillId: null });
  });

  it('refuses when the range holds nothing unbilled', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]);

    const res = await generateRangeContractorInvoice({ status: 'idle' }, form());

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('already on a contractor bill');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('stamps contractorBillId on exactly the entries it billed', async () => {
    await generateRangeContractorInvoice({ status: 'idle' }, form());

    expect(db.timesheetEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['te-sep', 'te-oct'] } },
      data: { contractorBillId: 'bill-proj1' },
    });
  });
});

describe('the number is suggested, never imposed', () => {
  it('sequences per person per year off their own bills', async () => {
    db.bill.findMany.mockResolvedValue([
      { supplierInvoiceNumber: 'JN-2026-001' },
      { supplierInvoiceNumber: 'JN-2026-003' },
      { supplierInvoiceNumber: 'ACME/0042' }, // their own scheme, ignored
    ]);

    const next = await suggestContractorInvoiceNumber('p1', d('2026-10-23'));

    expect(next).toBe('JN-2026-004');
  });

  it('starts at 001 for a contractor who has never invoiced', async () => {
    const next = await suggestContractorInvoiceNumber('p1', d('2026-10-23'));
    expect(next).toBe('JN-2026-001');
  });

  it('rejects a number this contractor has already used', async () => {
    db.bill.findFirst.mockResolvedValue({ id: 'bill-old' });

    const res = await generateRangeContractorInvoice({ status: 'idle' }, form());

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('already issued an invoice');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('still requires a number — prefilling is not issuing on their behalf', async () => {
    const res = await generateRangeContractorInvoice(
      { status: 'idle' },
      form({ contractorInvoiceNumber: '' }),
    );

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('your invoice, issued by you');
  });
});

describe('every field is the contractor’s (D5)', () => {
  it('uses the dates they chose, not today', async () => {
    await generateRangeContractorInvoice({ status: 'idle' }, form());

    const data = db.bill.create.mock.calls[0]![0].data;
    expect(data.issueDate).toEqual(d('2026-10-15'));
    expect(data.dueDate).toEqual(d('2026-10-29'));
  });

  it('carries their reference onto the bill, not just the audit trail', async () => {
    await generateRangeContractorInvoice(
      { status: 'idle' },
      form({ description: 'PO 88421 — Galileo phase 2' }),
    );

    const data = db.bill.create.mock.calls[0]![0].data;
    expect(data.description).toBe('PO 88421 — Galileo phase 2');
  });

  it('honours an overridden fee and keeps the derived figure beside it', async () => {
    await generateRangeContractorInvoice(
      { status: 'idle' },
      form({ 'fee:proj1': '3000' }),
    );

    const derived = 10 * SEPT_RATE + 4 * CURRENT_RATE;
    const data = db.bill.create.mock.calls[0]![0].data;
    expect(data.amountTotal).toBe(300_000 + 30_000);

    const written = vi.mocked(audit.writeAudit).mock.calls[0]![1];
    expect(written.entity.after).toMatchObject({
      feesExGstCents: 300_000,
      derivedFeesExGstCents: derived,
      feeWasOverridden: true,
    });
  });

  it('rejects a fee that is not an amount', async () => {
    const res = await generateRangeContractorInvoice(
      { status: 'idle' },
      form({ 'fee:proj1': 'about three grand' }),
    );

    expect(res).toMatchObject({ status: 'error' });
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('refuses a due date before the issue date', async () => {
    const res = await generateRangeContractorInvoice(
      { status: 'idle' },
      form({ issueDate: '2026-10-15', dueDate: '2026-10-01' }),
    );

    expect(res).toMatchObject({ status: 'error' });
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('refuses a backwards range', async () => {
    const res = await generateRangeContractorInvoice(
      { status: 'idle' },
      form({ start: '2026-10-14', end: '2026-09-15' }),
    );

    expect(res).toMatchObject({ status: 'error' });
    expect(db.bill.create).not.toHaveBeenCalled();
  });
});

describe('fees and expenses are two documents on the range path too (D6/D7)', () => {
  const EXPENSE = {
    id: 'x1',
    amount: 11_000,
    gst: 1_000,
    projectId: 'proj1',
    project: { code: 'CAC001' },
  };

  it('raises a separate expense bill under its own number', async () => {
    db.expense.findMany.mockResolvedValue([EXPENSE]);
    db.bill.create
      .mockResolvedValueOnce({ id: 'bill-fees' })
      .mockResolvedValueOnce({ id: 'bill-exp' });

    await generateRangeContractorInvoice({ status: 'idle' }, form());

    const bills = db.bill.create.mock.calls.map((c) => c[0].data);
    expect(bills).toHaveLength(2);

    const fees = bills.find((b) => b.category === 'Contractor — services')!;
    const exp = bills.find((b) => b.category === 'Contractor — expenses')!;

    // The fee bill is time only — no expense folded into it.
    expect(fees.amountTotal).toBe(
      10 * SEPT_RATE + 4 * CURRENT_RATE + Math.round((10 * SEPT_RATE + 4 * CURRENT_RATE) * 0.1),
    );
    expect(fees.supplierInvoiceNumber).toBe('JN-2026-004');

    // Recharged net + the contractor's own GST.
    expect(exp.amountTotal).toBe(10_000 + 1_000);
    expect(exp.gst).toBe(1_000);
    expect(exp.supplierInvoiceNumber).toBe('JN-2026-005');
  });

  it('takes the expense out of the reimbursement float, on the expense bill', async () => {
    db.expense.findMany.mockResolvedValue([EXPENSE]);
    db.bill.create
      .mockResolvedValueOnce({ id: 'bill-fees' })
      .mockResolvedValueOnce({ id: 'bill-exp' });

    await generateRangeContractorInvoice({ status: 'idle' }, form());

    expect(db.expense.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['x1'] } },
      data: { contractorBillId: 'bill-exp' },
    });
  });

  it('refuses expenses without their own number', async () => {
    db.expense.findMany.mockResolvedValue([EXPENSE]);

    const res = await generateRangeContractorInvoice(
      { status: 'idle' },
      form({ expenseInvoiceNumber: '' }),
    );

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('expense invoice number');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('refuses the same number on both documents', async () => {
    db.expense.findMany.mockResolvedValue([EXPENSE]);

    const res = await generateRangeContractorInvoice(
      { status: 'idle' },
      form({ expenseInvoiceNumber: 'JN-2026-004' }),
    );

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('different numbers');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('raises only the expense invoice when the range holds no hours', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]);
    db.expense.findMany.mockResolvedValue([EXPENSE]);
    db.bill.create.mockResolvedValueOnce({ id: 'bill-exp' });

    const res = await generateRangeContractorInvoice({ status: 'idle' }, form());

    expect(res).toMatchObject({ status: 'success' });
    const bills = db.bill.create.mock.calls.map((c) => c[0].data);
    expect(bills).toHaveLength(1);
    expect(bills[0]!.category).toBe('Contractor — expenses');
  });

  it('suggests two different numbers so the documents cannot collide', async () => {
    db.bill.findMany.mockResolvedValue([{ supplierInvoiceNumber: 'JN-2026-003' }]);

    const [fee, expense] = await suggestContractorInvoiceNumbers('p1', 2, d('2026-10-23'));

    expect(fee).toBe('JN-2026-004');
    expect(expense).toBe('JN-2026-005');
  });
});

describe('who may invoice', () => {
  it('refuses full-time staff — they are paid by pay run', async () => {
    db.person.findUnique.mockResolvedValue({
      id: 'p1',
      firstName: 'Rachael',
      lastName: 'Spooner',
      initials: 'RS',
      employment: 'ft',
      rate: CURRENT_RATE,
    });

    const res = await generateRangeContractorInvoice({ status: 'idle' }, form());

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('Only contractors');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('refuses invoicing in someone else’s name', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor('p2', ['staff']));

    const res = await generateRangeContractorInvoice({ status: 'idle' }, form());

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('your own invoice');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('lets an admin raise one on a contractor’s behalf, and says so', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor('admin1', ['admin']));

    const res = await generateRangeContractorInvoice({ status: 'idle' }, form());

    expect(res).toMatchObject({ status: 'success' });
    const written = vi.mocked(audit.writeAudit).mock.calls[0]![1];
    expect(written.entity.after).toMatchObject({ onBehalfByAdmin: true });
  });
});

describe('the preview tells the contractor what is missing', () => {
  it('lists unapproved time with the approver it is waiting on, and never bills it', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      entry('te-ok', '2026-09-20', 10),
      entry('te-wait', '2026-10-05', 4, { status: 'submitted' }),
      entry('te-draft', '2026-10-06', 2, { status: 'draft' }),
    ]);

    const preview = await previewContractorRangeInvoice(
      'p1',
      d('2026-09-15'),
      d('2026-10-14'),
    );

    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0]!.hours).toBe(10);

    const submitted = preview.pending.find((p) => p.status === 'submitted');
    expect(submitted).toMatchObject({ hours: 4 });
    expect(submitted!.waitingOn).toEqual(['Michael Roe', 'Chris Dale']);
    expect(preview.pending.find((p) => p.status === 'draft')).toMatchObject({ hours: 2 });
  });

  it('says nothing about hours already on a bill — the earlier invoice covers them', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      entry('te-ok', '2026-09-20', 10),
      entry('te-billed', '2026-09-21', 8, { contractorBillId: 'bill-earlier' }),
    ]);

    const preview = await previewContractorRangeInvoice(
      'p1',
      d('2026-09-15'),
      d('2026-10-14'),
    );

    expect(preview.groups[0]!.hours).toBe(10);
    expect(preview.pending).toHaveLength(0);
  });

  it('refuses full-time staff with a reason rather than an empty screen', async () => {
    db.person.findUnique.mockResolvedValue({ employment: 'ft', rate: CURRENT_RATE });

    const preview = await previewContractorRangeInvoice(
      'p1',
      d('2026-09-15'),
      d('2026-10-14'),
    );

    expect(preview.groups).toHaveLength(0);
    expect(preview.blockers.join(' ')).toContain('Only contractors');
  });

  it('names untagged expenses rather than dropping them silently', async () => {
    db.expense.findMany.mockResolvedValue([
      { id: 'x1', amount: 44_000, gst: 4_000, projectId: null, project: null },
      {
        id: 'x2',
        amount: 11_000,
        gst: 1_000,
        projectId: 'proj1',
        project: { id: 'proj1', code: 'CAC001', name: 'Galileo' },
      },
    ]);

    const preview = await previewContractorRangeInvoice(
      'p1',
      d('2026-09-15'),
      d('2026-10-14'),
    );

    expect(preview.excludedExpenseCount).toBe(1);
    expect(preview.groups[0]!.expenseTotalCents).toBe(11_000);
  });

  it('recharges expenses at net and adds the contractor’s own GST (D8)', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([entry('te-sep', '2026-09-20', 10)]);
    db.expense.findMany.mockResolvedValue([
      {
        id: 'x2',
        amount: 11_000, // GST-inclusive, as paid
        gst: 1_000,
        projectId: 'proj1',
        project: { id: 'proj1', code: 'CAC001', name: 'Galileo' },
      },
    ]);

    const preview = await previewContractorRangeInvoice(
      'p1',
      d('2026-09-15'),
      d('2026-10-14'),
    );

    const fees = 10 * SEPT_RATE;
    expect(preview.totals.feesExGstCents).toBe(fees);
    // They paid 11,000 inc GST, reclaim the 1,000 themselves, and bill the
    // 10,000 net plus 1,000 of their own.
    expect(preview.totals.expensePaidIncGstCents).toBe(11_000);
    expect(preview.totals.expensesExGstCents).toBe(10_000);
    expect(preview.totals.expenseGstCents).toBe(1_000);
    expect(preview.totals.amountTotalCents).toBe(
      fees + Math.round(fees * 0.1) + 10_000 + 1_000,
    );
  });

  it('grosses up a GST-free expense — where recharge and pass-through diverge', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([entry('te-sep', '2026-09-20', 10)]);
    db.expense.findMany.mockResolvedValue([
      {
        id: 'x3',
        amount: 44_000, // overseas flight: no GST inside it
        gst: 0,
        projectId: 'proj1',
        project: { id: 'proj1', code: 'CAC001', name: 'Galileo' },
      },
    ]);

    const preview = await previewContractorRangeInvoice(
      'p1',
      d('2026-09-15'),
      d('2026-10-14'),
    );

    // Nothing was reclaimable, so the net is the whole amount and the 10%
    // on top is a real increase on what the contractor paid.
    expect(preview.totals.expensesExGstCents).toBe(44_000);
    expect(preview.totals.expenseGstCents).toBe(4_400);
  });
});
