import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';

/**
 * TASK-506 — the admin escape hatch for D2.
 *
 * A month closes only when every project is approved, so an unresponsive lead
 * can block a contractor's payment indefinitely. This is what an admin does
 * when the chase hasn't worked — and the thing it must never be is silent.
 * Bypassing a named approver without a record of who was bypassed, why, and
 * by whom would be worse than the late approval it fixes.
 */

const db = vi.hoisted(() => ({
  timesheetPeriod: { findUnique: vi.fn(), update: vi.fn() },
  timesheetEntry: { findMany: vi.fn(), updateMany: vi.fn() },
  person: { findUnique: vi.fn(), findMany: vi.fn() },
  // TASK-509: the invoice now has an expense leg. Default to none so
  // these cases keep testing the hours path in isolation.
  expense: { findMany: vi.fn(), updateMany: vi.fn() },
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

const audit = await import('@/server/audit');
const userUpdates = await import('@/server/user-updates');
const { forceCloseTimesheetPeriod } = await import('@/app/(app)/timesheet/actions');

function sessionFor(id: string, roles: string[]): Session {
  return {
    person: {
      id,
      email: `${id}@foundry.health`,
      firstName: 'TT',
      lastName: 'Admin',
      initials: 'TT',
      roles: roles as Session['person']['roles'],
      headshotUrl: null,
      band: 'Partner' as Session['person']['band'],
    },
    realRoles: roles as Session['realRoles'],
    isRealSuperAdmin: roles.includes('super_admin'),
    viewAsRoles: null,
  };
}

const REASON = 'Michael is on leave until October and Jas needs paying.';

function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('targetPersonId', 'p1');
  fd.set('year', '2026');
  fd.set('month', '8');
  fd.set('reason', REASON);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

const OUTSTANDING = [
  {
    id: 'te1',
    hours: 24,
    project: { id: 'proj1', code: 'CAC001', managerId: 'mgr1', primaryPartnerId: 'ptr1' },
  },
  {
    id: 'te2',
    hours: 8,
    project: { id: 'proj2', code: 'CAC002', managerId: 'mgr2', primaryPartnerId: 'ptr1' },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.expense.findMany.mockResolvedValue([]);
  sessionMod.getSession.mockResolvedValue(sessionFor('admin1', ['super_admin']));
  db.timesheetPeriod.findUnique.mockResolvedValue({ id: 'per1', state: 'lodged' });
  db.timesheetEntry.findMany.mockResolvedValue(OUTSTANDING);
  db.person.findUnique.mockResolvedValue({ employment: 'ft', rate: null });
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => Promise<unknown>) => fn(db));
});

describe('authority and justification', () => {
  it('refuses anyone below the admin tier', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor('mgr1', ['manager']));

    const res = await forceCloseTimesheetPeriod({ status: 'idle' }, form());

    expect(res).toMatchObject({ status: 'error' });
    expect(db.timesheetEntry.updateMany).not.toHaveBeenCalled();
  });

  it('refuses without a substantive reason', async () => {
    const res = await forceCloseTimesheetPeriod({ status: 'idle' }, form({ reason: 'nah' }));

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('reason of at least 10');
    expect(db.timesheetEntry.updateMany).not.toHaveBeenCalled();
  });
});

describe('what it records', () => {
  it('names every bypassed project and who owed it', async () => {
    await forceCloseTimesheetPeriod({ status: 'idle' }, form());

    const after = vi.mocked(audit.writeAudit).mock.calls[0]![1].entity.after! as {
      reason: string;
      forcedHours: number;
      bypassedProjects: Array<{ projectCode: string; owedByPersonIds: string[] }>;
    };
    expect(after.reason).toBe(REASON);
    expect(after.forcedHours).toBe(32);
    expect(after.bypassedProjects.map((b) => b.projectCode)).toEqual(['CAC001', 'CAC002']);
    expect(after.bypassedProjects[0]!.owedByPersonIds).toEqual(['mgr1', 'ptr1']);
  });

  it('tells the contractor AND every bypassed approver', async () => {
    await forceCloseTimesheetPeriod({ status: 'idle' }, form());

    const [, recipients, payload] = vi.mocked(userUpdates.emitUserUpdateMany).mock.calls[0]!;
    expect([...recipients].sort()).toEqual(['mgr1', 'mgr2', 'p1', 'ptr1']);
    expect(payload.body).toContain(REASON);
    expect(payload.body).toContain('CAC001, CAC002');
  });

  it('approves the outstanding entries in the admin’s name', async () => {
    await forceCloseTimesheetPeriod({ status: 'idle' }, form());

    expect(db.timesheetEntry.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: { in: ['te1', 'te2'] } },
      data: { status: 'approved', approvedById: 'admin1' },
    });
  });
});

describe('it produces the same state as an ordinary close', () => {
  it('runs the normal roll-up so the invoice draft is frozen the same way', async () => {
    db.person.findUnique.mockResolvedValue({ employment: 'contractor', rate: 22_000 });
    db.timesheetEntry.findMany
      .mockResolvedValueOnce(OUTSTANDING)                         // outstanding scan
      .mockResolvedValueOnce([{ status: 'approved' }])            // roll-up
      .mockResolvedValueOnce([{ hours: 32 }]);                    // draft pricing

    const res = await forceCloseTimesheetPeriod({ status: 'idle' }, form());

    expect(res.status).toBe('success');
    expect(db.timesheetPeriod.update.mock.calls[0]![0].data).toMatchObject({
      state: 'approved',
      draftRateCents: 22_000,
      draftAmountExGstCents: 704_000,
    });
    expect((res as { message: string }).message).toContain('can now submit their invoice');
  });
});

describe('guards', () => {
  it('refuses a month that is not awaiting approval', async () => {
    db.timesheetPeriod.findUnique.mockResolvedValue({ id: 'per1', state: 'invoiced' });

    const res = await forceCloseTimesheetPeriod({ status: 'idle' }, form());

    expect((res as { message: string }).message).toContain('not awaiting approval');
    expect(db.timesheetEntry.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a month that was never lodged', async () => {
    db.timesheetPeriod.findUnique.mockResolvedValue(null);

    const res = await forceCloseTimesheetPeriod({ status: 'idle' }, form());

    expect((res as { message: string }).message).toContain('No lodged August 2026');
  });

  it('refuses when nothing is actually outstanding', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]);

    const res = await forceCloseTimesheetPeriod({ status: 'idle' }, form());

    expect((res as { message: string }).message).toContain('Nothing outstanding');
    expect(db.timesheetEntry.updateMany).not.toHaveBeenCalled();
  });
});
