import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Session } from '@/server/roles';
import { monthStartFrom } from '@/lib/week';

/**
 * TASK-502 — lodge a whole calendar month for approval.
 *
 * Two things this has to get right, because both are silent when wrong:
 *   1. Only `draft` rows move. Already-approved rows must keep their original
 *      approver and timestamp; re-lodging must not relitigate them.
 *   2. Warnings are advisory and blockers are not. A month with no hours can
 *      never be lodged; a month that merely looks odd can be waved through,
 *      but only after the server has said so — the check is server-side
 *      precisely so a client-side confirm can't be bypassed.
 */

const db = vi.hoisted(() => ({
  person: { findUnique: vi.fn(), findMany: vi.fn() },
  project: { findMany: vi.fn() },
  projectTeam: { findMany: vi.fn() },
  timesheetEntry: { findMany: vi.fn(), updateMany: vi.fn() },
  timesheetPeriod: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
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
vi.mock('@/server/integrations/whatsapp-prompts', () => ({
  sendTimesheetApprovalQueueNotice: vi.fn(),
}));

const sessionMod = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/server/session', () => sessionMod);

const audit = await import('@/server/audit');
const userUpdates = await import('@/server/user-updates');
const { lodgeMonth } = await import('@/app/(app)/timesheet/actions');

function sessionFor(id: string, roles: string[]): Session {
  return {
    person: {
      id,
      email: `${id}@foundry.health`,
      firstName: 'A',
      lastName: 'B',
      initials: 'AB',
      roles: roles as Session['person']['roles'],
      headshotUrl: null,
      band: 'Consultant' as Session['person']['band'],
    },
    realRoles: roles as Session['realRoles'],
    isRealSuperAdmin: roles.includes('super_admin'),
    viewAsRoles: null,
  };
}

const STAFF = sessionFor('p1', ['staff']);

function lodgeForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('targetPersonId', 'p1');
  fd.set('year', '2026');
  fd.set('month', '8');
  fd.set('acknowledge', 'false');
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

/** A worked entry on a given day of August 2026. */
function entry(day: number, status: string, id = `te${day}`, projectId = 'proj1') {
  return {
    id,
    date: new Date(Date.UTC(2026, 7, day)),
    hours: 8,
    status,
    projectId,
    project: { code: 'CAC001' },
  };
}

/** Every weekday of August 2026 worked, so no zero-hour-weekday warning. */
function fullAugust(status = 'draft') {
  const rows = [];
  for (let d = 1; d <= 31; d += 1) {
    const dow = new Date(Date.UTC(2026, 7, d)).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    rows.push(entry(d, status, `te${d}`));
  }
  return rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMod.getSession.mockResolvedValue(STAFF);
  db.person.findUnique.mockResolvedValue({
    firstName: 'Rachael',
    lastName: 'Spooner',
    endDate: null,
    inactiveAt: null,
  });
  db.person.findMany.mockResolvedValue([{ id: 'mgr1' }]);
  db.project.findMany.mockResolvedValue([
    { id: 'proj1', code: 'CAC001', stage: 'delivery', managerId: 'mgr1', primaryPartnerId: 'ptr1' },
  ]);
  db.projectTeam.findMany.mockResolvedValue([{ projectId: 'proj1' }]);
  db.timesheetPeriod.findUnique.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => Promise<unknown>) => fn(db));
  // September 2026 "today" — August is finished, so no unfinished-month
  // warning unless a test deliberately winds the clock back.
  vi.setSystemTime(new Date('2026-09-10T02:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('blockers refuse the lodge outright', () => {
  it('refuses a month with no hours', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]);
    const res = await lodgeMonth({ status: 'idle' }, lodgeForm());

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('nothing to lodge');
    expect(db.timesheetPeriod.upsert).not.toHaveBeenCalled();
  });

  it('refuses an already-approved month even with acknowledge set', async () => {
    db.timesheetPeriod.findUnique.mockResolvedValue({
      id: 'per1', personId: 'p1', year: 2026, month: 8, state: 'approved',
      lodgedAt: new Date(), approvedAt: new Date(), invoicedAt: null, contractorBillId: null,
    });
    db.timesheetEntry.findMany.mockResolvedValue(fullAugust('approved'));

    const res = await lodgeMonth({ status: 'idle' }, lodgeForm({ acknowledge: 'true' }));

    expect(res).toMatchObject({ status: 'error' });
    expect((res as { message: string }).message).toContain('already approved');
    expect(db.timesheetPeriod.upsert).not.toHaveBeenCalled();
  });
});

describe('warnings are advisory, and gate on the server', () => {
  it('returns warnings without writing when not acknowledged', async () => {
    // One worked day in a 21-weekday month → zero-hour-weekday warning.
    db.timesheetEntry.findMany.mockResolvedValue([entry(3, 'draft')]);

    const res = await lodgeMonth({ status: 'idle' }, lodgeForm());

    expect(res.status).toBe('warn');
    expect((res as { warnings: { code: string }[] }).warnings.map((w) => w.code)).toContain(
      'zero_hour_weekdays',
    );
    expect(db.timesheetPeriod.upsert).not.toHaveBeenCalled();
    expect(db.timesheetEntry.updateMany).not.toHaveBeenCalled();
  });

  it('proceeds once acknowledged, and records which warnings were waved through', async () => {
    db.timesheetEntry.findMany
      .mockResolvedValueOnce([entry(3, 'draft')])            // preflight
      .mockResolvedValueOnce([entry(3, 'draft')])            // drafts to move
      .mockResolvedValueOnce([]);                            // already submitted

    const res = await lodgeMonth({ status: 'idle' }, lodgeForm({ acknowledge: 'true' }));

    expect(res.status).toBe('success');
    const after = vi.mocked(audit.writeAudit).mock.calls[0]![1].entity.after!;
    expect(after.acknowledgedWarnings).toContain('zero_hour_weekdays');
  });

  it('warns that a month is unfinished when lodging it mid-month', async () => {
    vi.setSystemTime(new Date('2026-08-14T02:00:00Z'));
    db.timesheetEntry.findMany.mockResolvedValue(fullAugust('draft'));

    const res = await lodgeMonth({ status: 'idle' }, lodgeForm());

    expect(res.status).toBe('warn');
    expect((res as { warnings: { code: string }[] }).warnings.map((w) => w.code)).toContain(
      'month_not_finished',
    );
  });

  it('warns about hours on a project the person is not rostered on', async () => {
    db.projectTeam.findMany.mockResolvedValue([]);
    db.timesheetEntry.findMany.mockResolvedValue(fullAugust('draft'));

    const res = await lodgeMonth({ status: 'idle' }, lodgeForm());

    expect(res.status).toBe('warn');
    const codes = (res as { warnings: { code: string }[] }).warnings.map((w) => w.code);
    expect(codes).toContain('off_team_projects');
  });
});

describe('what actually moves', () => {
  beforeEach(() => {
    db.timesheetEntry.findMany
      .mockResolvedValueOnce(fullAugust('draft'))
      .mockResolvedValueOnce(fullAugust('draft'))
      .mockResolvedValueOnce([]);
  });

  it('submits drafts and lodges the period in one go', async () => {
    const res = await lodgeMonth({ status: 'idle' }, lodgeForm());

    expect(res.status).toBe('success');
    const move = db.timesheetEntry.updateMany.mock.calls[0]![0];
    expect(move.data).toEqual({ status: 'submitted' });
    expect(db.timesheetPeriod.upsert).toHaveBeenCalledTimes(1);
    const upsert = db.timesheetPeriod.upsert.mock.calls[0]![0];
    expect(upsert.where.personId_year_month).toEqual({ personId: 'p1', year: 2026, month: 8 });
    expect(upsert.update.state).toBe('lodged');
  });

  it('notifies the approvers once about the month, not once per week', async () => {
    await lodgeMonth({ status: 'idle' }, lodgeForm());

    expect(vi.mocked(userUpdates.emitUserUpdateMany)).toHaveBeenCalledTimes(1);
    const [, recipients, payload] = vi.mocked(userUpdates.emitUserUpdateMany).mock.calls[0]!;
    expect(recipients).toEqual(['mgr1']);
    expect(payload.kind).toBe('approval_requested');
    expect(payload.title).toContain('August 2026');
  });

  it('writes a timesheet_period audit event keyed to the month', async () => {
    await lodgeMonth({ status: 'idle' }, lodgeForm());

    const [, input] = vi.mocked(audit.writeAudit).mock.calls[0]!;
    expect(input.action).toBe('lodged');
    expect(input.entity.type).toBe('timesheet_period');
    expect(input.entity.id).toBe('p1:2026-08');
  });
});

describe('auto-approve rules are shared with the daily save', () => {
  it('a super-admin lodging their own month skips the queue', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor('p1', ['super_admin']));
    db.timesheetEntry.findMany
      .mockResolvedValueOnce(fullAugust('draft'))
      .mockResolvedValueOnce(fullAugust('draft'))
      .mockResolvedValueOnce([]);

    const res = await lodgeMonth({ status: 'idle' }, lodgeForm());

    expect(res.status).toBe('success');
    expect(db.timesheetEntry.updateMany.mock.calls[0]![0].data).toMatchObject({
      status: 'approved',
      approvedById: 'p1',
    });
    // Nothing queued → nobody pinged.
    expect(vi.mocked(userUpdates.emitUserUpdateMany)).not.toHaveBeenCalled();
  });

  it('an archived project never skips the queue, even for a super-admin', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor('p1', ['super_admin']));
    db.project.findMany.mockResolvedValue([
      { id: 'proj1', code: 'CAC001', stage: 'archived', managerId: 'mgr1', primaryPartnerId: 'ptr1' },
    ]);
    db.timesheetEntry.findMany
      .mockResolvedValueOnce(fullAugust('draft'))
      .mockResolvedValueOnce(fullAugust('draft'))
      .mockResolvedValueOnce([]);

    await lodgeMonth({ status: 'idle' }, lodgeForm());

    expect(db.timesheetEntry.updateMany.mock.calls[0]![0].data).toEqual({ status: 'submitted' });
  });
});

describe('re-lodging is idempotent', () => {
  it('moves nothing new but still re-notifies about what is queued', async () => {
    db.timesheetPeriod.findUnique.mockResolvedValue({
      id: 'per1', personId: 'p1', year: 2026, month: 8, state: 'lodged',
      lodgedAt: new Date(), approvedAt: null, invoicedAt: null, contractorBillId: null,
    });
    db.timesheetEntry.findMany
      .mockResolvedValueOnce(fullAugust('submitted'))  // preflight
      .mockResolvedValueOnce([])                       // no drafts left
      .mockResolvedValueOnce(fullAugust('submitted')); // already submitted

    const res = await lodgeMonth({ status: 'idle' }, lodgeForm({ acknowledge: 'true' }));

    expect(res.status).toBe('success');
    expect((res as { message: string }).message).toContain('Nothing new to submit');
    expect(db.timesheetEntry.updateMany).not.toHaveBeenCalled();
    // The period row is still stamped, so a re-lodge is safe to repeat.
    expect(db.timesheetPeriod.upsert).toHaveBeenCalledTimes(1);
  });
});
