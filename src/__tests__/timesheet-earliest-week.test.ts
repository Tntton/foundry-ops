import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TASK-524 — `/timesheet` opens on the oldest week still missing hours.
 *
 * It used to open on the current week, always. Someone two weeks behind had
 * to notice that for themselves and then click Previous twice, and the week
 * that wants attention is the oldest incomplete one rather than today's.
 *
 * The rule matches `preflightLodgeMonth`'s `zero_hour_weekdays`: Mon–Fri
 * only, strictly before today. A contractor working a Saturday is not the
 * common case, and if an empty Sunday counted then every week would qualify.
 */

const db = vi.hoisted(() => ({
  person: { findUnique: vi.fn() },
  timesheetEntry: { findMany: vi.fn() },
  timesheetPeriod: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

const { findEarliestWeekNeedingInput } = await import('@/server/timesheet');

/** Thursday. Mon–Wed of this week are in the past; Thu–Fri are not. */
const TODAY = new Date('2026-10-29T00:00:00Z');
const THIS_WEEK = '2026-10-26';
const LAST_WEEK = '2026-10-19';
const TWO_BACK = '2026-10-12';

function day(iso: string) {
  return { date: new Date(`${iso}T00:00:00Z`) };
}

/** Every weekday from `from` up to but not including `to`, as worked days. */
function workedWeekdaysBetween(from: string, to: string) {
  const out: Array<{ date: Date }> = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d < end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push({ date: new Date(d) });
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Started well before the lookback cap, so the cap is what binds.
  db.person.findUnique.mockResolvedValue({
    startDate: new Date('2024-01-01T00:00:00Z'),
  });
  db.timesheetEntry.findMany.mockResolvedValue([]);
  db.timesheetPeriod.findMany.mockResolvedValue([]);
});

describe('picking the week to open on', () => {
  it('returns the earliest week with a gap, not the most recent one', async () => {
    // Two weeks back is complete, last week is not.
    db.timesheetEntry.findMany.mockResolvedValue(
      workedWeekdaysBetween('2026-08-31', LAST_WEEK),
    );

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    expect(res.weekStart.toISOString().slice(0, 10)).toBe(LAST_WEEK);
    expect(res.missingDayCount).toBe(5);
  });

  it('stops at the FIRST incomplete week even when later ones are worse', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      // One day logged two weeks back; nothing since.
      day('2026-10-13'),
    ]);

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    // The cap floor is 8 weeks back, and that week is empty, so it wins.
    expect(res.weekStart.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('falls back to the current week when nothing is outstanding', async () => {
    db.timesheetEntry.findMany.mockResolvedValue(
      workedWeekdaysBetween('2026-08-31', '2026-10-29'),
    );

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    expect(res.weekStart.toISOString().slice(0, 10)).toBe(THIS_WEEK);
    expect(res.missingDayCount).toBe(0);
  });

  it('counts a partly-logged week as needing input', async () => {
    // Everything up to two weeks back, then Mon+Tue only of two-back.
    db.timesheetEntry.findMany.mockResolvedValue([
      ...workedWeekdaysBetween('2026-08-31', TWO_BACK),
      day('2026-10-12'),
      day('2026-10-13'),
    ]);

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    expect(res.weekStart.toISOString().slice(0, 10)).toBe(TWO_BACK);
    expect(res.missingDayCount).toBe(3); // Wed, Thu, Fri
  });

  it('ignores an empty weekend', async () => {
    // A week with all five weekdays logged is complete, Sat/Sun empty.
    db.timesheetEntry.findMany.mockResolvedValue(
      workedWeekdaysBetween('2026-08-31', '2026-10-29'),
    );

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    expect(res.weekStart.toISOString().slice(0, 10)).toBe(THIS_WEEK);
  });

  it('ignores today and the days after it', async () => {
    // Thursday. Mon–Wed logged; Thu and Fri empty but not yet owed.
    db.timesheetEntry.findMany.mockResolvedValue([
      ...workedWeekdaysBetween('2026-08-31', THIS_WEEK),
      day('2026-10-26'),
      day('2026-10-27'),
      day('2026-10-28'),
    ]);

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    expect(res.weekStart.toISOString().slice(0, 10)).toBe(THIS_WEEK);
    expect(res.missingDayCount).toBe(0);
  });
});

describe('the lower bounds', () => {
  it('never looks back past the person’s start date', async () => {
    // Started last Wednesday. The Mon/Tue before that are not their problem.
    db.person.findUnique.mockResolvedValue({
      startDate: new Date('2026-10-21T00:00:00Z'),
    });

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    expect(res.weekStart.toISOString().slice(0, 10)).toBe(LAST_WEEK);
    expect(res.cappedAtLookback).toBe(false);
    // The query floor is the start date's week, not 8 weeks back.
    expect(
      (db.timesheetEntry.findMany.mock.calls[0]![0].where.date.gte as Date)
        .toISOString()
        .slice(0, 10),
    ).toBe(LAST_WEEK);
  });

  it('caps the lookback and says so', async () => {
    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    expect(res.weekStart.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(res.cappedAtLookback).toBe(true);
  });

  it('honours an explicit lookback window', async () => {
    const res = await findEarliestWeekNeedingInput('p1', TODAY, {
      maxLookbackWeeks: 2,
    });

    expect(res.weekStart.toISOString().slice(0, 10)).toBe(TWO_BACK);
  });

  it('skips days inside a closed month — they cannot be filled in', async () => {
    // October is invoiced. Every empty weekday in it is locked (TASK-523),
    // so the scan must not land on a week nobody can type into.
    db.timesheetPeriod.findMany.mockResolvedValue([
      { year: 2026, month: 9, state: 'approved' },
      { year: 2026, month: 10, state: 'invoiced' },
    ]);

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    // Sep and Oct are both closed, and the window starts 2026-08-31 — the
    // only open day in range is Mon 31 Aug.
    expect(res.weekStart.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(res.missingDayCount).toBe(1);
  });

  it('judges a straddling week on its OPEN days only', async () => {
    // September closed, October open. The week of Mon 28 Sep runs into
    // Thu 1 Oct, so two of its days are still owed.
    db.person.findUnique.mockResolvedValue({
      startDate: new Date('2026-09-28T00:00:00Z'),
    });
    db.timesheetPeriod.findMany.mockResolvedValue([
      { year: 2026, month: 9, state: 'invoiced' },
    ]);

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    expect(res.weekStart.toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(res.missingDayCount).toBe(2); // Thu 1 Oct, Fri 2 Oct
  });

  it('returns the current week for someone who started this week', async () => {
    db.person.findUnique.mockResolvedValue({
      startDate: new Date('2026-10-27T00:00:00Z'),
    });

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    expect(res.weekStart.toISOString().slice(0, 10)).toBe(THIS_WEEK);
  });

  it('returns the current week when the person is missing', async () => {
    db.person.findUnique.mockResolvedValue(null);

    const res = await findEarliestWeekNeedingInput('p1', TODAY);

    expect(res.weekStart.toISOString().slice(0, 10)).toBe(THIS_WEEK);
    expect(db.timesheetEntry.findMany).not.toHaveBeenCalled();
  });
});
