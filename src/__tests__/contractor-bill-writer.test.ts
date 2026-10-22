import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';

/**
 * TASK-500 — the contractor draft-bill writer.
 *
 * This is the actual defect site. `generateDraftBillFromHours` used to do:
 *
 *   tx.timesheetEntry.updateMany({ ..., data: { status: 'billed' } })
 *
 * which, because `previewInvoiceFromTimesheets` filters `status='approved'`,
 * permanently removed those hours from the client-invoice pool as a side
 * effect of paying a contractor. Nothing warned; the hours just stopped
 * appearing. These tests pin the write payload so it can't come back.
 */

const tx = vi.hoisted(() => ({
  bill: { create: vi.fn() },
  timesheetEntry: { updateMany: vi.fn() },
}));
const db = vi.hoisted(() => ({
  person: { findUnique: vi.fn() },
  timesheetEntry: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const audit = vi.hoisted(() => ({ writeAudit: vi.fn() }));
const nav = vi.hoisted(() => ({ redirect: vi.fn() }));
const session = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', () => audit);
vi.mock('@/server/session', () => session);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => nav);

import { generateDraftBillFromHours } from '@/app/(app)/directory/people/[id]/draft-bill/actions';

const ADMIN: Session = {
  person: {
    id: 'admin1',
    email: 'trung@foundry.health',
    firstName: 'TT',
    lastName: 'Admin',
    initials: 'TT',
    roles: ['super_admin'] as Session['person']['roles'],
    headshotUrl: null,
    band: 'Partner' as Session['person']['band'],
  },
  realRoles: ['super_admin'] as Session['realRoles'],
  isRealSuperAdmin: true,
  viewAsRoles: null,
};

function form(): FormData {
  const fd = new FormData();
  fd.set('issueDate', '2026-08-31');
  fd.set('dueDate', '2026-09-14');
  fd.set('contractorInvoiceNumber', 'JN-0042');
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.getSession.mockResolvedValue(ADMIN);
  db.person.findUnique.mockResolvedValue({
    id: 'p1',
    firstName: 'Jas',
    lastName: 'Navarro',
    employment: 'contractor',
    rate: 22_000,
    billRate: 45_000,
  });
  tx.bill.create.mockResolvedValue({ id: 'bill-1' });
  tx.timesheetEntry.updateMany.mockResolvedValue({ count: 2 });
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
});

describe('generateDraftBillFromHours — AP leg only', () => {
  beforeEach(() => {
    db.timesheetEntry.findMany.mockResolvedValue([
      {
        id: 'te1',
        projectId: 'proj1',
        hours: 8,
        project: { code: 'CAC001', name: 'Capability Assessment' },
      },
      {
        id: 'te2',
        projectId: 'proj1',
        hours: 8,
        project: { code: 'CAC001', name: 'Capability Assessment' },
      },
    ]);
  });

  it('links entries to the bill and NEVER touches status', async () => {
    await generateDraftBillFromHours('p1', { status: 'idle' }, form());

    expect(tx.timesheetEntry.updateMany).toHaveBeenCalledTimes(1);
    const call = tx.timesheetEntry.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual({ id: { in: ['te1', 'te2'] } });
    expect(call.data).toEqual({ contractorBillId: 'bill-1' });
    // The regression: writing `status` here is what destroyed the AR pool.
    expect(call.data).not.toHaveProperty('status');
    // And the AR leg is not this flow's to touch either.
    expect(call.data).not.toHaveProperty('billedInvoiceId');
  });

  it('selects candidates on the AP leg, not the AR leg', async () => {
    await generateDraftBillFromHours('p1', { status: 'idle' }, form());

    expect(db.timesheetEntry.findMany.mock.calls[0]![0].where).toEqual({
      personId: 'p1',
      status: 'approved',
      contractorBillId: null,
    });
  });

  it('still records the consumed entry ids on the audit event', async () => {
    // The TASK-500 migration backfills historical rows from this payload, and
    // it remains the only trace of which hours a given bill covers.
    await generateDraftBillFromHours('p1', { status: 'idle' }, form());

    const after = audit.writeAudit.mock.calls[0]![1].entity.after;
    expect(after.source).toBe('timesheet_draft_bill');
    expect(after.timesheetEntryIds).toEqual(['te1', 'te2']);
    expect(after.hours).toBe(16);
  });
});

describe('guards', () => {
  it('refuses full-time staff — they are paid via pay runs, not bills', async () => {
    db.person.findUnique.mockResolvedValue({
      id: 'p2',
      firstName: 'Full',
      lastName: 'Timer',
      employment: 'ft',
      rate: 22_000,
      billRate: 45_000,
    });
    const res = await generateDraftBillFromHours('p2', { status: 'idle' }, form());

    expect(res).toMatchObject({
      status: 'error',
      message: expect.stringContaining('only generated for contractors'),
    });
    expect(tx.timesheetEntry.updateMany).not.toHaveBeenCalled();
  });

  it('reports nothing to bill when every approved hour is already on a bill', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]);
    const res = await generateDraftBillFromHours('p1', { status: 'idle' }, form());

    expect(res).toMatchObject({
      status: 'error',
      message: expect.stringContaining('already'),
    });
    expect(tx.bill.create).not.toHaveBeenCalled();
  });
});
