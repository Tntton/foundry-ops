import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';
import { monthStartFrom } from '@/lib/week';

/**
 * TASK-501 — a full 31-day month survives the save path.
 *
 * A 31-day month sits exactly on the Zod ceiling: `SaveSchema.dayCount` is
 * `.max(31)` and `CellSchema.hours` is `z.array(...).max(31)`. An off-by-one
 * anywhere in that chain would break January, March, May, July, August,
 * October and December while leaving the 30-day months working — the kind of
 * bug that ships. These tests walk the real action over a real month.
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
  auditEvent: { create: vi.fn() },
  // Month-level lock lookup (TASK-523). Empty = every month still open.
  timesheetPeriod: { findMany: vi.fn() },
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

import { saveTimesheet } from '@/app/(app)/timesheet/actions';

const STAFF: Session = {
  person: {
    id: 'p1',
    email: 'rachael.spooner@foundry.health',
    firstName: 'Rachael',
    lastName: 'Spooner',
    initials: 'RS',
    roles: ['staff'] as Session['person']['roles'],
    headshotUrl: null,
    band: 'Consultant' as Session['person']['band'],
  },
  realRoles: ['staff'] as Session['realRoles'],
  isRealSuperAdmin: false,
  viewAsRoles: null,
};

/** A month's worth of form fields, 8h on every day listed in `hoursByIndex`. */
function monthForm(
  year: number,
  month: number,
  dayCount: number,
  hoursByIndex: Record<number, number>,
  intent: 'save' | 'submit' = 'submit',
): FormData {
  const fd = new FormData();
  fd.set('targetPersonId', 'p1');
  fd.set('rangeStart', monthStartFrom(year, month).toISOString().slice(0, 10));
  fd.set('dayCount', String(dayCount));
  fd.set('intent', intent);
  fd.append('projectId', 'proj1');
  fd.set('description::proj1', 'Delivery');
  for (let i = 0; i < dayCount; i += 1) {
    fd.set(`hours::proj1::${i}`, String(hoursByIndex[i] ?? 0));
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  // No closed months unless a test says so — see timesheet-period-lock.
  db.timesheetPeriod.findMany.mockResolvedValue([]);
  sessionMod.getSession.mockResolvedValue(STAFF);
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
  db.person.findMany.mockResolvedValue([]);
  db.$transaction.mockResolvedValue([]);
});

describe('a 31-day month round-trips through saveTimesheet', () => {
  it('writes one entry per worked day across all 31 days of August', async () => {
    // 8h on the 1st, the 16th and the 31st — first, middle, and the boundary
    // day that a max(30) would silently drop.
    const res = await saveTimesheet(
      { status: 'idle' },
      monthForm(2026, 8, 31, { 0: 8, 15: 8, 30: 8 }),
    );

    expect(res.status).toBe('success');
    expect(db.timesheetEntry.upsert).toHaveBeenCalledTimes(3);
    const dates = db.timesheetEntry.upsert.mock.calls.map((c) =>
      (c[0].where.personId_projectId_date.date as Date).toISOString().slice(0, 10),
    );
    expect(dates).toEqual(['2026-08-01', '2026-08-16', '2026-08-31']);
  });

  it('submits every worked day for approval, not just the first week', async () => {
    await saveTimesheet({ status: 'idle' }, monthForm(2026, 8, 31, { 0: 8, 30: 8 }));

    for (const call of db.timesheetEntry.upsert.mock.calls) {
      expect(call[0].create.status).toBe('submitted');
    }
  });

  it('records the full 31-day range on the audit event', async () => {
    await saveTimesheet({ status: 'idle' }, monthForm(2026, 8, 31, { 0: 8, 30: 8 }));

    const audit = db.auditEvent.create.mock.calls[0]![0].data;
    expect(audit.entityType).toBe('timesheet_range');
    expect(audit.entityId).toBe('p1:2026-08-01:31');
    expect(audit.action).toBe('submitted');
    expect(audit.entityDelta.created.dayCount).toBe(31);
    expect(audit.entityDelta.created.totalHours).toBe(16);
  });

  it('accepts a leap February without truncating the 29th', async () => {
    await saveTimesheet({ status: 'idle' }, monthForm(2028, 2, 29, { 28: 8 }));

    expect(db.timesheetEntry.upsert).toHaveBeenCalledTimes(1);
    const date = db.timesheetEntry.upsert.mock.calls[0]![0].where
      .personId_projectId_date.date as Date;
    expect(date.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('rejects a single cell above 24h at the schema', async () => {
    // `halfHour` is z.coerce.number().min(0).max(24), so one oversized cell
    // never reaches the cross-project day check below.
    const res = await saveTimesheet(
      { status: 'idle' },
      monthForm(2026, 8, 31, { 30: 25 }),
    );

    expect(res).toMatchObject({
      status: 'error',
      message: 'Invalid timesheet payload',
    });
    expect(db.timesheetEntry.upsert).not.toHaveBeenCalled();
  });

  it('still enforces the 24h/day ceiling across projects on the last day', async () => {
    db.projectTeam.findMany.mockResolvedValue([
      { projectId: 'proj1' },
      { projectId: 'proj2' },
    ]);
    db.project.findMany.mockResolvedValue([
      { id: 'proj1', code: 'CAC001', stage: 'delivery', managerId: 'mgr1', primaryPartnerId: 'ptr1' },
      { id: 'proj2', code: 'CAC002', stage: 'delivery', managerId: 'mgr1', primaryPartnerId: 'ptr1' },
    ]);
    const fd = monthForm(2026, 8, 31, { 30: 13 });
    fd.append('projectId', 'proj2');
    fd.set('description::proj2', 'Delivery');
    for (let i = 0; i < 31; i += 1) fd.set(`hours::proj2::${i}`, i === 30 ? '13' : '0');

    const res = await saveTimesheet({ status: 'idle' }, fd);

    expect(res).toMatchObject({
      status: 'error',
      message: expect.stringContaining('exceeds 24h'),
    });
    // Names the real calendar day, not an index into the block.
    expect((res as { message: string }).message).toContain('2026-08-31');
    expect(db.timesheetEntry.upsert).not.toHaveBeenCalled();
  });
});
