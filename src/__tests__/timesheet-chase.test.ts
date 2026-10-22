import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  chaseActionFor,
  chaseConfigFromEnv,
  chaseMessage,
  type ChaseTarget,
} from '@/server/timesheet-chase';

/**
 * TASK-506 — chasing the approvers who hold up a contractor's payment.
 *
 * D2 (TT 2026-08-31) closes a month only when every project in it is
 * approved. That is what gives a contractor one invoice per month, and its
 * cost is that one unresponsive lead blocks their payment indefinitely.
 * These are the mitigations, so the thing they must not do is go quiet or
 * spam: a stuck month should nudge on an interval, escalate exactly once,
 * and never nag about a month that isn't actually blocked.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-09-20T00:00:00Z');
const CFG = { chaseAfterDays: 3, escalateAfterDays: 7 };

function ago(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

describe('chaseConfigFromEnv', () => {
  it('defaults to 3 and 7 days', () => {
    expect(chaseConfigFromEnv({})).toEqual({ chaseAfterDays: 3, escalateAfterDays: 7 });
  });

  it('reads overrides from env rather than hard-coding (A8)', () => {
    expect(
      chaseConfigFromEnv({
        TIMESHEET_CHASE_AFTER_DAYS: '1',
        TIMESHEET_ESCALATE_AFTER_DAYS: '4',
      }),
    ).toEqual({ chaseAfterDays: 1, escalateAfterDays: 4 });
  });

  it('falls back rather than trusting junk or zero', () => {
    expect(
      chaseConfigFromEnv({
        TIMESHEET_CHASE_AFTER_DAYS: 'soon',
        TIMESHEET_ESCALATE_AFTER_DAYS: '0',
      }),
    ).toEqual({ chaseAfterDays: 3, escalateAfterDays: 7 });
  });
});

describe('chaseActionFor', () => {
  it('stays quiet inside the grace period', () => {
    expect(
      chaseActionFor(
        { lodgedAt: ago(1), lastChasedAt: null, escalatedAt: null },
        NOW,
        CFG,
      ),
    ).toBe('none');
  });

  it('chases once the month has waited long enough', () => {
    expect(
      chaseActionFor(
        { lodgedAt: ago(3), lastChasedAt: null, escalatedAt: null },
        NOW,
        CFG,
      ),
    ).toBe('chase');
  });

  it('does not re-chase the next day', () => {
    // The cron runs daily; without this a stuck month emits a feed row every
    // single day and people learn to ignore it.
    expect(
      chaseActionFor(
        { lodgedAt: ago(4), lastChasedAt: ago(1), escalatedAt: null },
        NOW,
        CFG,
      ),
    ).toBe('none');
  });

  it('re-chases once the interval has elapsed again', () => {
    expect(
      chaseActionFor(
        { lodgedAt: ago(6), lastChasedAt: ago(3), escalatedAt: null },
        NOW,
        CFG,
      ),
    ).toBe('chase');
  });

  it('escalates past the second threshold', () => {
    expect(
      chaseActionFor(
        { lodgedAt: ago(7), lastChasedAt: ago(1), escalatedAt: null },
        NOW,
        CFG,
      ),
    ).toBe('escalate');
  });

  it('escalates only once per lodgement', () => {
    expect(
      chaseActionFor(
        { lodgedAt: ago(30), lastChasedAt: ago(30), escalatedAt: ago(20) },
        NOW,
        CFG,
      ),
    ).toBe('chase');
  });

  it('escalation supersedes a due chase rather than firing alongside it', () => {
    // Two notifications about the same month in one run is how people learn
    // to ignore both.
    expect(
      chaseActionFor(
        { lodgedAt: ago(10), lastChasedAt: ago(5), escalatedAt: null },
        NOW,
        CFG,
      ),
    ).toBe('escalate');
  });

  it('never chases a period that was never lodged', () => {
    expect(
      chaseActionFor({ lodgedAt: null, lastChasedAt: null, escalatedAt: null }, NOW, CFG),
    ).toBe('none');
  });
});

describe('chaseMessage', () => {
  const base: ChaseTarget = {
    periodId: 'per1',
    personId: 'p1',
    personName: 'Jas Navarro',
    year: 2026,
    month: 8,
    monthLabel: 'August 2026',
    action: 'chase',
    ageDays: 5,
    outstanding: [
      { projectCode: 'CAC001', hours: 24, owedByPersonId: 'mgr1' },
      { projectCode: 'CAC002', hours: 8, owedByPersonId: 'mgr2' },
    ],
    outstandingHours: 32,
    recipientIds: ['mgr1', 'mgr2'],
  };

  it('names the person, the month, the projects and the stake', () => {
    const { title, body } = chaseMessage(base);

    expect(title).toContain('Jas Navarro');
    expect(title).toContain('August 2026');
    expect(body).toContain('5 days');
    expect(body).toContain('32.0h');
    expect(body).toContain('CAC001, CAC002');
    // The stake is the point — an approver needs to know this blocks a
    // payment, not just a timesheet.
    expect(body).toContain("invoice can't be raised");
  });

  it('marks an escalation as such', () => {
    const { title, body } = chaseMessage({ ...base, action: 'escalate', ageDays: 9 });

    expect(title).toContain('Overdue approval');
    expect(body).toContain('Escalation');
  });
});

// ─── findChaseTargets against a mocked DB ───────────────────────────────────

const db = vi.hoisted(() => ({
  timesheetPeriod: { findMany: vi.fn() },
  timesheetEntry: { findMany: vi.fn() },
  person: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

const { findChaseTargets } = await import('@/server/timesheet-chase');

function lodgedPeriod(overrides: Record<string, unknown> = {}) {
  return {
    id: 'per1',
    personId: 'p1',
    year: 2026,
    month: 8,
    lodgedAt: ago(5),
    lastChasedAt: null,
    escalatedAt: null,
    person: { firstName: 'Jas', lastName: 'Navarro' },
    ...overrides,
  };
}

function submitted(code: string, managerId: string | null, hours = 8) {
  return {
    hours,
    project: { code, managerId, primaryPartnerId: 'ptr1' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.person.findMany.mockResolvedValue([{ id: 'admin1' }]);
});

describe('findChaseTargets', () => {
  it('targets the leads who owe the outstanding projects', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([lodgedPeriod()]);
    db.timesheetEntry.findMany.mockResolvedValue([
      submitted('CAC001', 'mgr1', 24),
      submitted('CAC002', 'mgr2', 8),
    ]);

    const [t] = await findChaseTargets(NOW, CFG);

    expect(t!.action).toBe('chase');
    expect(t!.outstandingHours).toBe(32);
    expect(t!.recipientIds.sort()).toEqual(['mgr1', 'mgr2', 'ptr1']);
    // Admins are not pulled in on a plain chase.
    expect(t!.recipientIds).not.toContain('admin1');
  });

  it('pulls in the admin tier on escalation', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([lodgedPeriod({ lodgedAt: ago(9) })]);
    db.timesheetEntry.findMany.mockResolvedValue([submitted('CAC001', 'mgr1')]);

    const [t] = await findChaseTargets(NOW, CFG);

    expect(t!.action).toBe('escalate');
    expect(t!.recipientIds).toContain('admin1');
  });

  it('never nudges someone about their own timesheet', async () => {
    // A lead logging hours on the project they run.
    db.timesheetPeriod.findMany.mockResolvedValue([lodgedPeriod({ personId: 'mgr1' })]);
    db.timesheetEntry.findMany.mockResolvedValue([submitted('CAC001', 'mgr1')]);

    const [t] = await findChaseTargets(NOW, CFG);

    expect(t!.recipientIds).not.toContain('mgr1');
  });

  it('skips a month with nothing actually outstanding', async () => {
    // A stale roll-up is not a reason to nag anybody.
    db.timesheetPeriod.findMany.mockResolvedValue([lodgedPeriod()]);
    db.timesheetEntry.findMany.mockResolvedValue([]);

    expect(await findChaseTargets(NOW, CFG)).toEqual([]);
  });

  it('skips a month still inside its grace period', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([lodgedPeriod({ lodgedAt: ago(1) })]);

    expect(await findChaseTargets(NOW, CFG)).toEqual([]);
    expect(db.timesheetEntry.findMany).not.toHaveBeenCalled();
  });

  it('reads only submitted entries in the right month', async () => {
    db.timesheetPeriod.findMany.mockResolvedValue([lodgedPeriod()]);
    db.timesheetEntry.findMany.mockResolvedValue([submitted('CAC001', 'mgr1')]);

    await findChaseTargets(NOW, CFG);

    const where = db.timesheetEntry.findMany.mock.calls[0]![0].where;
    expect(where.status).toBe('submitted');
    expect(where.date.gte.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(where.date.lt.toISOString().slice(0, 10)).toBe('2026-09-01');
  });
});
