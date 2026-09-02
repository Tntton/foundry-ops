import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';
import { buildContractorInvoiceReadyWhatsApp } from '@/server/integrations/whatsapp-prompts';

/**
 * TASK-504 — the contractor's invoice for a closed month.
 *
 * D1 (TT 2026-08-31): Foundry prepares the figures, the CONTRACTOR issues the
 * invoice. That distinction is what keeps this out of the AU recipient-created
 * tax invoice regime, which would need a written agreement per contractor.
 * Concretely it means: their invoice number is mandatory, and no Bill exists
 * until they submit.
 *
 * The other load-bearing rule is the rate snapshot. The figures a contractor
 * confirms must be the ones the approvals produced, so pricing reads the rate
 * frozen at close, never Person.rate as of today.
 */

const db = vi.hoisted(() => ({
  person: { findUnique: vi.fn() },
  timesheetPeriod: { findUnique: vi.fn(), update: vi.fn() },
  timesheetEntry: { findMany: vi.fn(), updateMany: vi.fn() },
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

const audit = await import('@/server/audit');
const { confirmContractorInvoice } = await import('@/app/(app)/me/invoices/actions');

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

const RATE_AT_CLOSE = 22_000; // $220/h

function approvedPeriod(overrides: Record<string, unknown> = {}) {
  return {
    id: 'per1',
    personId: 'p1',
    year: 2026,
    month: 8,
    state: 'approved',
    lodgedAt: new Date(),
    approvedAt: new Date(),
    invoicedAt: null,
    contractorBillId: null,
    draftRateCents: RATE_AT_CLOSE,
    draftHours: 10,
    draftAmountExGstCents: 220_000,
    draftPreparedAt: new Date(),
    ...overrides,
  };
}

function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('personId', 'p1');
  fd.set('year', '2026');
  fd.set('month', '8');
  fd.set('contractorInvoiceNumber', 'JN-2026-08');
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
    employment: 'contractor',
    endDate: null,
  });
  db.timesheetPeriod.findUnique.mockResolvedValue(approvedPeriod());
  db.timesheetEntry.findMany.mockResolvedValue([
    { id: 'te1', projectId: 'proj1', hours: 6, project: { code: 'CAC001' } },
    { id: 'te2', projectId: 'proj2', hours: 4, project: { code: 'CAC002' } },
  ]);
  db.bill.create.mockImplementation(async ({ data }: { data: { projectId: string } }) => ({
    id: `bill-${data.projectId}`,
  }));
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => Promise<unknown>) => fn(db));
});

describe('the contractor issues it, not Foundry', () => {
  it('refuses without the contractor’s own invoice number', async () => {
    const res = await confirmContractorInvoice(
      { status: 'idle' },
      form({ contractorInvoiceNumber: '' }),
    );

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('your invoice, issued by you');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('puts their number on every bill and records that they issued it', async () => {
    await confirmContractorInvoice({ status: 'idle' }, form());

    for (const call of db.bill.create.mock.calls) {
      expect(call[0].data.supplierInvoiceNumber).toBe('JN-2026-08');
    }
    const billAudit = vi.mocked(audit.writeAudit).mock.calls[0]![1].entity.after!;
    expect(billAudit.issuedByContractor).toBe(true);
  });

  it('lands in AP review rather than straight through to payment', async () => {
    await confirmContractorInvoice({ status: 'idle' }, form());

    for (const call of db.bill.create.mock.calls) {
      expect(call[0].data.status).toBe('pending_review');
    }
  });
});

describe('the frozen rate is what prices the invoice', () => {
  it('uses the rate captured at close, not Person.rate today', async () => {
    // Person.rate is deliberately absent from the confirm read — if the code
    // ever reaches for it this test still passes, so assert on the amounts.
    await confirmContractorInvoice({ status: 'idle' }, form());

    const byProject = Object.fromEntries(
      db.bill.create.mock.calls.map((c) => [c[0].data.projectId, c[0].data]),
    );
    // 6h and 4h at $220/h, +10% GST. Computed with integer cents — money is
    // never a float in this codebase, and `4 * 22000 * 1.1` is 96800.000…1.
    const exGst = (h: number) => h * RATE_AT_CLOSE;
    const gst = (h: number) => Math.round(exGst(h) * 0.1);
    expect(byProject['proj1'].amountTotal).toBe(exGst(6) + gst(6));
    expect(byProject['proj2'].amountTotal).toBe(exGst(4) + gst(4));
    expect(byProject['proj1'].gst).toBe(gst(6));
    expect(Number.isInteger(byProject['proj1'].amountTotal)).toBe(true);
  });

  it('refuses when no rate was captured at close', async () => {
    db.timesheetPeriod.findUnique.mockResolvedValue(
      approvedPeriod({ draftRateCents: null }),
    );

    const res = await confirmContractorInvoice({ status: 'idle' }, form());

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('ask an admin');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('records the frozen rate on the audit event so the amount is explicable later', async () => {
    await confirmContractorInvoice({ status: 'idle' }, form());

    const after = vi.mocked(audit.writeAudit).mock.calls[0]![1].entity.after!;
    expect(after.rateCentsAtClose).toBe(RATE_AT_CLOSE);
  });
});

describe('one bill per project, AP leg only', () => {
  it('splits by project so each hits its own P&L', async () => {
    const res = await confirmContractorInvoice({ status: 'idle' }, form());

    expect(res.status).toBe('success');
    expect(db.bill.create).toHaveBeenCalledTimes(2);
  });

  it('links entries via contractorBillId and never touches status or the AR leg', async () => {
    await confirmContractorInvoice({ status: 'idle' }, form());

    for (const call of db.timesheetEntry.updateMany.mock.calls) {
      expect(Object.keys(call[0].data)).toEqual(['contractorBillId']);
    }
  });

  it('only picks up hours not already on a contractor bill', async () => {
    await confirmContractorInvoice({ status: 'idle' }, form());

    expect(db.timesheetEntry.findMany.mock.calls[0]![0].where).toMatchObject({
      status: 'approved',
      contractorBillId: null,
    });
  });

  it('closes the period as invoiced', async () => {
    await confirmContractorInvoice({ status: 'idle' }, form());

    expect(db.timesheetPeriod.update.mock.calls[0]![0].data).toMatchObject({
      state: 'invoiced',
    });
  });
});

describe('guards', () => {
  it('refuses a month that is not yet fully approved', async () => {
    db.timesheetPeriod.findUnique.mockResolvedValue(approvedPeriod({ state: 'lodged' }));

    const res = await confirmContractorInvoice({ status: 'idle' }, form());

    expect((res as { message: string }).message).toContain('every project in it is approved');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('refuses to invoice the same month twice', async () => {
    db.timesheetPeriod.findUnique.mockResolvedValue(approvedPeriod({ state: 'invoiced' }));

    const res = await confirmContractorInvoice({ status: 'idle' }, form());

    expect((res as { message: string }).message).toContain('already been invoiced');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('refuses full-time staff — they are paid via pay runs', async () => {
    db.person.findUnique.mockResolvedValue({
      id: 'p1', firstName: 'Full', lastName: 'Timer', employment: 'ft', endDate: null,
    });

    const res = await confirmContractorInvoice({ status: 'idle' }, form());

    expect((res as { message: string }).message).toContain('paid via pay runs');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('will not let one person invoice in another’s name', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor('someone-else', ['staff']));

    const res = await confirmContractorInvoice({ status: 'idle' }, form());

    expect((res as { message: string }).message).toContain('only submit your own');
    expect(db.bill.create).not.toHaveBeenCalled();
  });

  it('lets an admin submit on a contractor’s behalf, and says so in the audit', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor('admin1', ['super_admin']));

    const res = await confirmContractorInvoice({ status: 'idle' }, form());

    expect(res.status).toBe('success');
    const after = vi.mocked(audit.writeAudit).mock.calls[0]![1].entity.after!;
    expect(after.onBehalfByAdmin).toBe(true);
  });
});

describe('the WhatsApp nudge does not claim Foundry invoiced them', () => {
  it('points at the confirm screen rather than announcing an invoice', () => {
    const body = buildContractorInvoiceReadyWhatsApp({
      firstName: 'Jas',
      monthLabel: 'August 2026',
      hours: 10,
      amountExGstCents: 220_000,
      appBaseUrl: 'https://ops.foundry.health',
    });

    expect(body).toContain('pre-filled an invoice');
    expect(body).toContain('add your invoice number');
    expect(body).toContain('/me/invoices');
    // Wording matters: claiming we invoiced on their behalf would describe
    // an RCTI arrangement that does not exist.
    expect(body.toLowerCase()).not.toContain('we have invoiced');
    expect(body.toLowerCase()).not.toContain('raised an invoice on your behalf');
  });
});
