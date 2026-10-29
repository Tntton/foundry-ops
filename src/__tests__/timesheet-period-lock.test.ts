import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';
import { isCellEditable, cellLockKind } from '@/lib/timesheet-lock';

/**
 * TASK-523 — a timesheet that has been approved AND invoiced is locked.
 *
 * Two holes, both on the write side, both invisible from the grid:
 *
 * 1. **A super admin could rewrite a billed hour.** `isCellEditable` has
 *    refused a billed day for everyone since TASK-514, but `saveTimesheet`
 *    only ever checked `status === 'approved'` with a super-admin bypass. So
 *    the UI said locked and the server said yes. The DELETE path guarded both
 *    billing legs; the UPDATE path next to it did not, which meant a
 *    super admin could not zero an invoiced day but could change it from 8h
 *    to 2h.
 *
 * 2. **An invoiced month accepted brand-new hours.** Every guard keyed off an
 *    EXISTING entry, so a day with nothing logged had nothing to refuse. The
 *    month's invoice had already gone out; the new hours sat outside it.
 *    Hence the month-level `periodLock`, which is the only lock that can see
 *    an empty day.
 */

const db = vi.hoisted(() => ({
  person: { findUnique: vi.fn(), findMany: vi.fn() },
  projectTeam: { findMany: vi.fn(), create: vi.fn() },
  project: { findMany: vi.fn() },
  timesheetEntry: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  timesheetPeriod: { findMany: vi.fn() },
  auditEvent: { create: vi.fn() },
  userUpdate: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/capabilities', () => ({ requireCapability: vi.fn() }));
vi.mock('@/server/audit', async () => {
  const actual = await vi.importActual<typeof import('@/server/audit')>('@/server/audit');
  return { ...actual, writeAudit: vi.fn() };
});
vi.mock('@/server/user-updates', () => ({ emitUserUpdateMany: vi.fn() }));
vi.mock('@/server/revalidate-schedule', () => ({ revalidateScheduleSurfaces: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const sessionMod = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/server/session', () => sessionMod);

const { saveTimesheet } = await import('@/app/(app)/timesheet/actions');
const { getPeriodLocksForRange, periodLockFor } = await import('@/server/timesheet');

// ── The pure rule ────────────────────────────────────────────────────────

describe('the month lock, on top of the per-day rule', () => {
  const open = { status: null, billed: false } as const;

  it('locks every day of an invoiced month, super admin included', () => {
    const cell = { ...open, periodLock: 'invoiced' as const };
    expect(isCellEditable(cell, false)).toBe(false);
    expect(isCellEditable(cell, true)).toBe(false);
  });

  it('locks an EMPTY day in an invoiced month', () => {
    // The whole point. Nothing is logged, nothing is approved, nothing is
    // billed — and it still must not accept hours, because the invoice for
    // that month has gone out.
    expect(
      isCellEditable({ status: null, billed: false, periodLock: 'invoiced' }, true),
    ).toBe(false);
  });

  it('locks an approved month for everyone but a super admin', () => {
    const cell = { ...open, periodLock: 'approved' as const };
    expect(isCellEditable(cell, false)).toBe(false);
    expect(isCellEditable(cell, true)).toBe(true);
  });

  it('leaves an open or merely lodged month alone', () => {
    // `lodged` is a submission, not a close — it never reaches this type.
    expect(isCellEditable({ ...open, periodLock: null }, false)).toBe(true);
    expect(isCellEditable(open, false)).toBe(true);
  });

  it('reports the document lock ahead of the month lock', () => {
    // Both apply; voiding the document is the action that unblocks it, so
    // that is the one the message has to name.
    expect(
      cellLockKind(
        { status: 'approved', billed: true, periodLock: 'invoiced' },
        true,
      ),
    ).toBe('billed');
    expect(
      cellLockKind(
        { status: 'approved', billed: false, periodLock: 'invoiced' },
        true,
      ),
    ).toBe('period_invoiced');
  });

  it('returns no reason for a day this viewer can edit', () => {
    expect(cellLockKind({ status: 'approved', billed: false }, true)).toBeNull();
    expect(cellLockKind({ status: 'draft', billed: false }, false)).toBeNull();
  });
});

// ── The month enumeration ────────────────────────────────────────────────

describe('getPeriodLocksForRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.timesheetPeriod.findMany.mockResolvedValue([]);
  });

  it('asks for both months when a week straddles the boundary', async () => {
    await getPeriodLocksForRange(
      'p1',
      new Date('2026-10-26T00:00:00Z'), // Mon
      new Date('2026-11-02T00:00:00Z'),
    );
    expect(db.timesheetPeriod.findMany.mock.calls[0]![0].where.OR).toEqual([
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
    ]);
  });

  it('rolls over the year', async () => {
    await getPeriodLocksForRange(
      'p1',
      new Date('2025-12-29T00:00:00Z'),
      new Date('2026-01-05T00:00:00Z'),
    );
    expect(db.timesheetPeriod.findMany.mock.calls[0]![0].where.OR).toEqual([
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ]);
  });

  it('never asks about open or lodged months', async () => {
    // Lodging is a submission. Locking on it would stop someone adding the
    // hours they forgot before anyone had decided anything.
    await getPeriodLocksForRange(
      'p1',
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-11-01T00:00:00Z'),
    );
    expect(db.timesheetPeriod.findMany.mock.calls[0]![0].where.state).toEqual({
      in: ['approved', 'invoiced'],
    });
  });

  it('keys the result by month so a straddling week reads both', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([
      { year: 2026, month: 10, state: 'invoiced' },
    ]);
    const locks = await getPeriodLocksForRange(
      'p1',
      new Date('2026-10-26T00:00:00Z'),
      new Date('2026-11-02T00:00:00Z'),
    );
    expect(periodLockFor(locks, new Date('2026-10-30T00:00:00Z'))).toBe('invoiced');
    expect(periodLockFor(locks, new Date('2026-11-01T00:00:00Z'))).toBeNull();
  });
});

// ── The save guard ───────────────────────────────────────────────────────

function session(roles: string[]): Session {
  return {
    person: {
      id: 'p1',
      email: 'rachael.spooner@foundry.health',
      firstName: 'Rachael',
      lastName: 'Spooner',
      initials: 'RS',
      roles: roles as Session['person']['roles'],
      headshotUrl: null,
      band: 'Consultant' as Session['person']['band'],
    },
    realRoles: roles as Session['realRoles'],
    isRealSuperAdmin: roles.includes('super_admin'),
    viewAsRoles: null,
  };
}

/** One week starting Mon 2026-10-05, `hours` on the Monday. */
function weekForm(hours: number): FormData {
  const fd = new FormData();
  fd.set('targetPersonId', 'p1');
  fd.set('rangeStart', '2026-10-05');
  fd.set('dayCount', '7');
  fd.set('intent', 'save');
  fd.append('projectId', 'proj1');
  fd.set('description::proj1', 'Delivery');
  for (let i = 0; i < 7; i += 1) {
    fd.set(`hours::proj1::${i}`, String(i === 0 ? hours : 0));
  }
  return fd;
}

/** A stored Monday entry, in the shape the pre-fetch select returns. */
function stored(
  over: Partial<{
    status: string;
    hours: number;
    billedInvoiceId: string | null;
    contractorBillId: string | null;
  }> = {},
) {
  return {
    id: 'te1',
    projectId: 'proj1',
    date: new Date('2026-10-05T00:00:00Z'),
    status: 'approved',
    billedInvoiceId: null,
    contractorBillId: null,
    hours: 8,
    ...over,
  };
}

describe('saveTimesheet refuses a locked day', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMod.getSession.mockResolvedValue(session(['super_admin']));
    db.person.findUnique.mockResolvedValue({
      inactiveAt: null,
      endDate: null,
      firstName: 'Rachael',
      lastName: 'Spooner',
    });
    db.projectTeam.findMany.mockResolvedValue([{ projectId: 'proj1' }]);
    db.project.findMany.mockResolvedValue([
      {
        id: 'proj1',
        code: 'CAC001',
        stage: 'delivery',
        managerId: 'mgr1',
        primaryPartnerId: 'ptr1',
      },
    ]);
    db.timesheetEntry.findMany.mockResolvedValue([]);
    db.timesheetPeriod.findMany.mockResolvedValue([]);
    db.person.findMany.mockResolvedValue([]);
    db.$transaction.mockResolvedValue([]);
  });

  it('will not let a super admin rewrite an hour that is on a client invoice', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      stored({ billedInvoiceId: 'inv1' }),
    ]);

    const res = await saveTimesheet({ status: 'idle' }, weekForm(2));

    expect(db.timesheetEntry.update).not.toHaveBeenCalled();
    expect(res.status).toBe('error');
    expect(res).toHaveProperty('message', expect.stringContaining('invoice'));
  });

  it('will not let a super admin rewrite an hour on a contractor bill either', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      stored({ contractorBillId: 'bill1' }),
    ]);

    await saveTimesheet({ status: 'idle' }, weekForm(2));

    expect(db.timesheetEntry.update).not.toHaveBeenCalled();
  });

  it('will not let a super admin zero a billed day', async () => {
    // The delete path already guarded both legs. Asserted so the two paths
    // can't drift apart again.
    db.timesheetEntry.findMany.mockResolvedValue([
      stored({ billedInvoiceId: 'inv1' }),
    ]);

    await saveTimesheet({ status: 'idle' }, weekForm(0));

    expect(db.timesheetEntry.delete).not.toHaveBeenCalled();
  });

  it('still lets a super admin override an approved-but-unbilled day', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([stored()]);

    const res = await saveTimesheet({ status: 'idle' }, weekForm(2));

    expect(db.timesheetEntry.update).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('success');
  });

  it('refuses new hours in an invoiced month, with nothing stored to refuse', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]); // empty day
    db.timesheetPeriod.findMany.mockResolvedValue([
      { year: 2026, month: 10, state: 'invoiced' },
    ]);

    const res = await saveTimesheet({ status: 'idle' }, weekForm(8));

    expect(db.timesheetEntry.upsert).not.toHaveBeenCalled();
    expect(res.status).toBe('error');
    expect(res).toHaveProperty('message', expect.stringContaining('invoiced'));
  });

  it('refuses a non-super-admin in an approved month but lets a super admin in', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]);
    db.timesheetPeriod.findMany.mockResolvedValue([
      { year: 2026, month: 10, state: 'approved' },
    ]);

    sessionMod.getSession.mockResolvedValue(session(['staff']));
    expect((await saveTimesheet({ status: 'idle' }, weekForm(8))).status).toBe('error');
    expect(db.timesheetEntry.upsert).not.toHaveBeenCalled();

    sessionMod.getSession.mockResolvedValue(session(['super_admin']));
    expect((await saveTimesheet({ status: 'idle' }, weekForm(8))).status).toBe('success');
    expect(db.timesheetEntry.upsert).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a locked day the save did not try to change', async () => {
    // The grid posts a hidden field carrying the stored hours for every
    // locked day. Reporting those as refusals would put a warning on every
    // ordinary save of a week that happens to contain one.
    db.timesheetEntry.findMany.mockResolvedValue([
      stored({ billedInvoiceId: 'inv1', hours: 8 }),
    ]);

    const res = await saveTimesheet({ status: 'idle' }, weekForm(8));

    expect(res.status).toBe('success');
    expect(res).toHaveProperty('message', expect.not.stringContaining('locked'));
  });

  it('records the refusal on the audit event', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      stored({ billedInvoiceId: 'inv1' }),
    ]);

    await saveTimesheet({ status: 'idle' }, weekForm(2));

    const audit = db.auditEvent.create.mock.calls[0]![0].data;
    expect(audit.entityDelta.created.refusedCells).toEqual([
      { dayKey: '2026-10-05', kind: 'billed' },
    ]);
  });
});
