import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addMonths,
  daysInMonth,
  formatMonthLabel,
  monthDates,
  monthNumber,
  monthStartFrom,
  startOfMonth,
} from '@/lib/week';

/**
 * TASK-501 — the month grid is a REAL calendar month.
 *
 * It used to be `startOfFourWeekBlock` / `fourWeekDates`: a rolling 28-day
 * window anchored on the current week. It drifted against the calendar and so
 * never once lined up with a named month, which made monthly lodgement
 * impossible — a contractor cannot invoice for a period the app can't select.
 */

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i has %i days', (y, m, expected) => {
    expect(daysInMonth(y, m)).toBe(expected);
  });

  it('handles leap years', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    // Century rule: 2100 is not a leap year, 2000 was.
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});

describe('startOfMonth', () => {
  it('normalises any day in the month to the 1st at UTC midnight', () => {
    expect(startOfMonth(new Date('2026-08-31T23:59:59.999Z')).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(startOfMonth(new Date('2026-08-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
  });
});

describe('monthDates', () => {
  it('covers exactly the month, first day to last', () => {
    const days = monthDates(startOfMonth(new Date('2026-08-14T00:00:00Z')));
    expect(days).toHaveLength(31);
    expect(days[0]!.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(days.at(-1)!.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('produces 29 cells for a leap February', () => {
    const days = monthDates(monthStartFrom(2028, 2));
    expect(days).toHaveLength(29);
    expect(days.at(-1)!.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('never spills into the neighbouring month', () => {
    for (let m = 1; m <= 12; m += 1) {
      const days = monthDates(monthStartFrom(2026, m));
      expect(new Set(days.map((d) => d.getUTCMonth())).size).toBe(1);
      expect(days[0]!.getUTCMonth()).toBe(m - 1);
    }
  });
});

describe('addMonths', () => {
  it('steps whole months and stays on the 1st', () => {
    const aug = monthStartFrom(2026, 8);
    expect(addMonths(aug, 1).toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(addMonths(aug, -1).toISOString().slice(0, 10)).toBe('2026-07-01');
  });

  it('rolls across the year boundary in both directions', () => {
    expect(addMonths(monthStartFrom(2026, 12), 1).toISOString().slice(0, 10)).toBe(
      '2027-01-01',
    );
    expect(addMonths(monthStartFrom(2026, 1), -1).toISOString().slice(0, 10)).toBe(
      '2025-12-01',
    );
  });

  it('cannot overflow a short month', () => {
    // The classic setUTCMonth bug: 31 Jan + 1 month → 2 or 3 March. Because
    // we always sit on the 1st and rebuild from parts, stepping Jan → Feb →
    // Mar lands on the 1st every time.
    let cur = monthStartFrom(2026, 1);
    const seen: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      seen.push(cur.toISOString().slice(0, 10));
      cur = addMonths(cur, 1);
    }
    expect(seen.every((d) => d.endsWith('-01'))).toBe(true);
    expect(seen[1]).toBe('2026-02-01');
    expect(seen[2]).toBe('2026-03-01');
    expect(seen[13]).toBe('2027-02-01');
  });

  it('round-trips through a full year without drifting', () => {
    // This is precisely what the old rolling 28-day block could not do.
    const start = monthStartFrom(2026, 3);
    let cur = start;
    for (let i = 0; i < 12; i += 1) cur = addMonths(cur, 1);
    expect(cur.toISOString()).toBe(monthStartFrom(2027, 3).toISOString());
  });
});

describe('monthNumber / monthStartFrom round-trip', () => {
  it('survives a full year in both directions', () => {
    for (let m = 1; m <= 12; m += 1) {
      const start = monthStartFrom(2026, m);
      expect(monthNumber(start)).toBe(m);
      expect(start.getUTCFullYear()).toBe(2026);
    }
  });
});

describe('formatMonthLabel', () => {
  it('names the month a person would recognise as their lodgement period', () => {
    expect(formatMonthLabel(monthStartFrom(2026, 8))).toBe('August 2026');
  });

  it('is not shifted by the local timezone', () => {
    // Rendered from a UTC-midnight Date; without timeZone:'UTC' a machine
    // behind UTC would label 1 August as "July".
    expect(formatMonthLabel(monthStartFrom(2026, 1))).toBe('January 2026');
    expect(formatMonthLabel(monthStartFrom(2026, 12))).toBe('December 2026');
  });
});

// ─── getMonthForPerson reads the whole month ────────────────────────────────

const db = vi.hoisted(() => ({
  timesheetEntry: { findMany: vi.fn() },
  projectTeam: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

const { getMonthForPerson } = await import('@/server/timesheet');

describe('getMonthForPerson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.timesheetEntry.findMany.mockResolvedValue([]);
    db.projectTeam.findMany.mockResolvedValue([]);
  });

  it.each([
    ['a 31-day month', 2026, 8, 31, '2026-09-01'],
    ['a 30-day month', 2026, 9, 30, '2026-10-01'],
    ['a short February', 2026, 2, 28, '2026-03-01'],
    ['a leap February', 2028, 2, 29, '2028-03-01'],
  ])('queries exactly %s', async (_label, year, month, _days, exclusiveEnd) => {
    await getMonthForPerson('p1', monthStartFrom(year, month));

    const where = db.timesheetEntry.findMany.mock.calls[0]![0].where;
    expect(where.date.gte.toISOString().slice(0, 10)).toBe(
      monthStartFrom(year, month).toISOString().slice(0, 10),
    );
    // Exclusive upper bound = the 1st of the next month, so the last day of
    // a 31-day month is included and nothing from the next month leaks in.
    expect(where.date.lt.toISOString().slice(0, 10)).toBe(exclusiveEnd);
  });

  it('normalises a mid-month anchor to the whole month', async () => {
    await getMonthForPerson('p1', new Date('2026-08-17T00:00:00Z'));

    const where = db.timesheetEntry.findMany.mock.calls[0]![0].where;
    expect(where.date.gte.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(where.date.lt.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('returns one cell per day of the month', async () => {
    db.projectTeam.findMany.mockResolvedValue([
      {
        projectId: 'proj1',
        project: { id: 'proj1', code: 'CAC001', name: 'Cap Assessment', stage: 'delivery' },
      },
    ]);
    const rows = await getMonthForPerson('p1', monthStartFrom(2026, 8));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.cells).toHaveLength(31);
    expect(rows[0]!.cells.at(-1)!.date.toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});
