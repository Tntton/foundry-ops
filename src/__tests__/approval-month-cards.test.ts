import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';

/**
 * TASK-503 — the approval queue groups by person × MONTH, not person × week.
 *
 * The old grouping shattered one monthly lodgement into five weekly cards, so
 * a manager approved the same person five times. The subtle half is scoping:
 * a manager who leads one of three projects must see the whole month (a card
 * claiming 8h when the month is 140h is worse than useless for deciding) but
 * may only ACT on their own slice.
 */

const db = vi.hoisted(() => ({
  timesheetEntry: { findMany: vi.fn() },
  timesheetPeriod: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

const { listPendingMonthCards } = await import('@/server/timesheet');

function sessionWith(id: string, roles: string[]): Session {
  return {
    person: {
      id,
      email: `${id}@foundry.health`,
      firstName: 'A',
      lastName: 'B',
      initials: 'AB',
      roles: roles as Session['person']['roles'],
      headshotUrl: null,
      band: 'Manager' as Session['person']['band'],
    },
    realRoles: roles as Session['realRoles'],
    isRealSuperAdmin: roles.includes('super_admin'),
    viewAsRoles: null,
  };
}

const PERSON = {
  id: 'p1',
  initials: 'JN',
  headshotUrl: null,
  firstName: 'Jas',
  lastName: 'Navarro',
};

function row(
  day: number,
  projectId: string,
  managerId: string,
  monthIndex = 7, // August
  hours = 8,
) {
  return {
    id: `te-${projectId}-${day}-${monthIndex}`,
    date: new Date(Date.UTC(2026, monthIndex, day)),
    hours,
    description: 'Delivery',
    personId: 'p1',
    projectId,
    person: PERSON,
    project: {
      id: projectId,
      code: projectId.toUpperCase(),
      name: `Project ${projectId}`,
      managerId,
      primaryPartnerId: 'ptr1',
    },
  };
}

beforeEach(() => {
  // mockReset, not clearAllMocks: the early-return path (no decidable
  // entries) consumes only the first queued `mockResolvedValueOnce`, and a
  // leftover second one would silently satisfy the NEXT test's first query.
  db.timesheetEntry.findMany.mockReset();
  db.timesheetPeriod.findMany.mockReset();
  db.timesheetPeriod.findMany.mockResolvedValue([]);
});

describe('grouping', () => {
  it('collapses a whole month into ONE card, not one per week', async () => {
    // Four weeks of August — the old queue produced five cards from this.
    const august = [1, 8, 15, 22, 29].map((d) => row(d, 'proj1', 'mgr1'));
    db.timesheetEntry.findMany.mockResolvedValue(august);

    const cards = await listPendingMonthCards(sessionWith('mgr1', ['manager']));

    expect(cards).toHaveLength(1);
    expect(cards[0]!.monthLabel).toBe('August 2026');
    expect(cards[0]!.totalHours).toBe(40);
    expect(cards[0]!.entries).toHaveLength(5);
  });

  it('keeps separate months as separate cards, oldest first', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      row(3, 'proj1', 'mgr1', 8), // September
      row(3, 'proj1', 'mgr1', 7), // August
    ]);

    const cards = await listPendingMonthCards(sessionWith('mgr1', ['manager']));

    expect(cards.map((c) => c.monthLabel)).toEqual(['August 2026', 'September 2026']);
  });

  it('subtotals by project inside the card', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      row(1, 'proj1', 'mgr1'),
      row(2, 'proj1', 'mgr1'),
      row(3, 'proj2', 'mgr1'),
    ]);

    const cards = await listPendingMonthCards(sessionWith('mgr1', ['manager']));

    expect(cards[0]!.projects.map((p) => [p.projectCode, p.hours])).toEqual([
      ['PROJ1', 16],
      ['PROJ2', 8],
    ]);
  });
});

describe('per-project scoping for a partial approver', () => {
  const mixed = [
    row(1, 'proj1', 'mgr1'), // mine
    row(2, 'proj2', 'mgr2'), // someone else's
    row(3, 'proj3', 'mgr3'), // someone else's
  ];

  beforeEach(() => {
    // First call = the viewer's decidable slice; second = month context.
    db.timesheetEntry.findMany
      .mockResolvedValueOnce([mixed[0]])
      .mockResolvedValueOnce(mixed);
  });

  it('shows the whole month but only offers the viewer their slice', async () => {
    const cards = await listPendingMonthCards(sessionWith('mgr1', ['manager']));

    expect(cards).toHaveLength(1);
    expect(cards[0]!.totalHours).toBe(24);
    expect(cards[0]!.decidableHours).toBe(8);
    expect(cards[0]!.decidableEntryIds).toEqual([mixed[0]!.id]);
  });

  it('names who owes each project the viewer cannot decide', async () => {
    const cards = await listPendingMonthCards(sessionWith('mgr1', ['manager']));

    const byCode = Object.fromEntries(
      cards[0]!.projects.map((p) => [p.projectCode, p]),
    );
    expect(byCode['PROJ1']!.canDecide).toBe(true);
    expect(byCode['PROJ1']!.owedByPersonId).toBeNull();
    expect(byCode['PROJ2']!.canDecide).toBe(false);
    expect(byCode['PROJ2']!.owedByPersonId).toBe('mgr2');
  });

  it('flags each entry so the detail list can grey out the untouchable rows', async () => {
    const cards = await listPendingMonthCards(sessionWith('mgr1', ['manager']));

    expect(cards[0]!.entries.filter((e) => e.canDecide)).toHaveLength(1);
    expect(cards[0]!.entries.filter((e) => !e.canDecide)).toHaveLength(2);
  });
});

describe('visibility', () => {
  it('drops a card entirely when the viewer can decide none of it', async () => {
    db.timesheetEntry.findMany
      .mockResolvedValueOnce([])                                  // nothing of mine
      .mockResolvedValueOnce([row(1, 'proj2', 'mgr2')]);          // context

    const cards = await listPendingMonthCards(sessionWith('mgr1', ['manager']));

    expect(cards).toEqual([]);
  });

  it('gives admins every submission in one query, no context pass needed', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      row(1, 'proj1', 'mgr1'),
      row(2, 'proj2', 'mgr2'),
    ]);

    const cards = await listPendingMonthCards(sessionWith('admin1', ['super_admin']));

    expect(db.timesheetEntry.findMany).toHaveBeenCalledTimes(1);
    expect(cards[0]!.decidableHours).toBe(16);
    expect(cards[0]!.projects.every((p) => p.canDecide)).toBe(true);
  });

  it('lets a primary partner decide their project even when they do not manage it', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([row(1, 'proj1', 'mgr1')]);

    const cards = await listPendingMonthCards(sessionWith('ptr1', ['partner']));

    expect(cards[0]!.decidableHours).toBe(8);
  });
});

describe('lodgement state on the card', () => {
  it('marks a month that was lodged as a whole', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([row(1, 'proj1', 'mgr1')]);
    db.timesheetPeriod.findMany.mockResolvedValue([
      { personId: 'p1', year: 2026, month: 8, state: 'lodged' },
    ]);

    const cards = await listPendingMonthCards(sessionWith('mgr1', ['manager']));

    expect(cards[0]!.periodState).toBe('lodged');
  });

  it('reports null for loose weekly submissions with no period row', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([row(1, 'proj1', 'mgr1')]);

    const cards = await listPendingMonthCards(sessionWith('mgr1', ['manager']));

    expect(cards[0]!.periodState).toBeNull();
  });
});
