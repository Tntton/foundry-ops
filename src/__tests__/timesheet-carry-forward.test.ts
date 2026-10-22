import { describe, it, expect, vi, beforeEach } from 'vitest';
import { monthStartFrom } from '@/lib/week';

/**
 * TASK-510 — a new sheet opens with the projects you worked on LAST period,
 * not every project you're allocated to.
 *
 * Allocation is a poor proxy for "what I'm actually working on": people sit
 * on project teams for months without touching them, and every one of those
 * rows had to be deleted by hand from a sheet they were never going to fill
 * in. Carrying the previous period forward self-cleans, because a zero-hour
 * row leaves no TimesheetEntry behind.
 */

const db = vi.hoisted(() => ({
  timesheetEntry: { findMany: vi.fn() },
  projectTeam: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

const { getWeekForPerson, getMonthForPerson } = await import('@/server/timesheet');

function proj(id: string, code: string, stage = 'delivery') {
  return { id, code, name: `Project ${code}`, stage };
}
/** A row shaped like the findMany include. */
function entry(projectId: string, code: string, day: string, hours = 8) {
  return {
    id: `te-${projectId}-${day}`,
    projectId,
    date: new Date(`${day}T00:00:00Z`),
    hours,
    description: '',
    status: 'approved',
    billedInvoiceId: null,
    contractorBillId: null,
    project: proj(projectId, code),
  };
}
function team(projectId: string, code: string) {
  return { projectId, project: proj(projectId, code) };
}

const WEEK = new Date('2026-10-19T00:00:00Z'); // a Monday

beforeEach(() => {
  vi.clearAllMocks();
  db.timesheetEntry.findMany.mockResolvedValue([]);
  db.projectTeam.findMany.mockResolvedValue([]);
});

/** getRangeForPerson fires [current entries, allocations, previous entries]. */
function mockReads(opts: {
  current?: unknown[];
  allocations?: unknown[];
  previous?: unknown[];
}) {
  db.timesheetEntry.findMany
    .mockResolvedValueOnce(opts.current ?? [])
    .mockResolvedValueOnce(opts.previous ?? []);
  db.projectTeam.findMany.mockResolvedValue(opts.allocations ?? []);
}

describe('week view carries the previous week forward', () => {
  it('shows last week’s projects and drops untouched allocations', async () => {
    mockReads({
      current: [],
      // Allocated to three, worked on one.
      allocations: [team('p1', 'CAC001'), team('p2', 'CAC002'), team('p3', 'CAC003')],
      previous: [entry('p2', 'CAC002', '2026-10-15')],
    });

    const rows = await getWeekForPerson('p1-person', WEEK);

    expect(rows.map((r) => r.projectCode)).toEqual(['CAC002']);
  });

  it('queries exactly the seven days before the week', async () => {
    mockReads({ previous: [entry('p2', 'CAC002', '2026-10-15')] });

    await getWeekForPerson('p1-person', WEEK);

    const prevWhere = db.timesheetEntry.findMany.mock.calls[1]![0].where;
    expect(prevWhere.date.gte.toISOString().slice(0, 10)).toBe('2026-10-12');
    expect(prevWhere.date.lt.toISOString().slice(0, 10)).toBe('2026-10-19');
  });

  it('still shows a project that has hours in the CURRENT week', async () => {
    // Started something new this week that wasn't on last week's sheet.
    mockReads({
      current: [entry('p9', 'NEW001', '2026-10-20')],
      previous: [entry('p2', 'CAC002', '2026-10-15')],
    });

    const rows = await getWeekForPerson('p1-person', WEEK);

    expect(rows.map((r) => r.projectCode).sort()).toEqual(['CAC002', 'NEW001']);
  });

  it('never carries a project that has since been archived', async () => {
    mockReads({ previous: [entry('p2', 'CAC002', '2026-10-15')] });

    await getWeekForPerson('p1-person', WEEK);

    // The filter is in the query, so an archived project never comes back.
    expect(db.timesheetEntry.findMany.mock.calls[1]![0].where.project).toEqual({
      stage: { not: 'archived' },
    });
  });
});

describe('falling back when there is no previous period', () => {
  it('uses allocations for someone with nothing logged last week', async () => {
    // New starter, or back from leave. An empty grid would make them hunt
    // through the picker for their own projects.
    mockReads({
      current: [],
      allocations: [team('p1', 'CAC001'), team('p2', 'CAC002')],
      previous: [],
    });

    const rows = await getWeekForPerson('p1-person', WEEK);

    expect(rows.map((r) => r.projectCode)).toEqual(['CAC001', 'CAC002']);
  });

  it('does NOT fall back merely because the carried set is small', async () => {
    mockReads({
      allocations: [team('p1', 'CAC001'), team('p2', 'CAC002'), team('p3', 'CAC003')],
      previous: [entry('p3', 'CAC003', '2026-10-15')],
    });

    const rows = await getWeekForPerson('p1-person', WEEK);

    expect(rows.map((r) => r.projectCode)).toEqual(['CAC003']);
  });
});

describe('month view carries the previous CALENDAR month', () => {
  it('reads the whole prior month, not 31 days back', async () => {
    mockReads({ previous: [entry('p2', 'CAC002', '2026-02-10')] });

    // March — a fixed 31-day lookback would start inside February and miss
    // the first days of it.
    await getMonthForPerson('p1-person', monthStartFrom(2026, 3));

    const prevWhere = db.timesheetEntry.findMany.mock.calls[1]![0].where;
    expect(prevWhere.date.gte.toISOString().slice(0, 10)).toBe('2026-02-01');
    expect(prevWhere.date.lt.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  it('rolls back across the year boundary', async () => {
    mockReads({ previous: [] });

    await getMonthForPerson('p1-person', monthStartFrom(2026, 1));

    const prevWhere = db.timesheetEntry.findMany.mock.calls[1]![0].where;
    expect(prevWhere.date.gte.toISOString().slice(0, 10)).toBe('2025-12-01');
    expect(prevWhere.date.lt.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
});

describe('the Copy-last-week lookup opts out', () => {
  it('reads allocations, so it does not recurse another week back', async () => {
    mockReads({ allocations: [team('p1', 'CAC001')] });

    await getWeekForPerson('p1-person', WEEK, false);

    // Current-period read only — no second timesheetEntry query at all.
    expect(db.timesheetEntry.findMany).toHaveBeenCalledTimes(1);
  });
});
