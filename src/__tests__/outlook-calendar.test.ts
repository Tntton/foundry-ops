import { describe, it, expect } from 'vitest';
import {
  blocksAvailability,
  blocksByDay,
  planSync,
  baselineHoursForPerson,
  type GraphCalendarEvent,
  type ExistingRow,
} from '@/server/integrations/outlook-calendar';

/**
 * TASK-522 — Outlook calendar → availability forecast.
 *
 * TT's three answers (2026-10-23) are the spec these tests hold to:
 *   Q1  all-day plus out-of-office only — a 30-minute standup must not
 *       eat forecast hours.
 *   Q2  fill blanks only — a human forecast is never overwritten.
 *   Q3  read-only; nothing is written back to a calendar.
 */

let seq = 0;
const ev = (p: Partial<GraphCalendarEvent>): GraphCalendarEvent => ({
  id: `e${(seq += 1)}`,
  subject: 'Event',
  isAllDay: false,
  isCancelled: false,
  showAs: 'busy',
  start: { dateTime: '2026-10-26T09:00:00.0000000', timeZone: 'Australia/Sydney' },
  end: { dateTime: '2026-10-26T10:00:00.0000000', timeZone: 'Australia/Sydney' },
  ...p,
});

const week = [
  '2026-10-26', // Mon
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30', // Fri
  '2026-10-31', // Sat
  '2026-11-01', // Sun
];
/** Eight-hour weekdays, nothing at the weekend. */
const eightHourWeekday = (iso: string) =>
  iso === '2026-10-31' || iso === '2026-11-01' ? 0 : 8;

describe('blocksAvailability — Q1', () => {
  it('ignores an ordinary busy meeting', () => {
    expect(blocksAvailability(ev({ showAs: 'busy' }))).toBe(false);
  });

  it('ignores tentative and working-elsewhere', () => {
    expect(blocksAvailability(ev({ showAs: 'tentative' }))).toBe(false);
    expect(blocksAvailability(ev({ showAs: 'workingElsewhere' }))).toBe(false);
  });

  it('counts out-of-office however short', () => {
    expect(blocksAvailability(ev({ showAs: 'oof' }))).toBe(true);
  });

  it('counts an all-day event that is not marked free', () => {
    expect(blocksAvailability(ev({ isAllDay: true, showAs: 'busy' }))).toBe(true);
  });

  it('ignores an all-day banner marked free', () => {
    // Birthdays, sprint names, subscribed holiday feeds. Zeroing a day
    // on one of these would be wrong far more often than right.
    expect(blocksAvailability(ev({ isAllDay: true, showAs: 'free' }))).toBe(false);
  });

  it('ignores a cancelled event whatever it says', () => {
    expect(blocksAvailability(ev({ showAs: 'oof', isCancelled: true }))).toBe(false);
    expect(
      blocksAvailability(ev({ isAllDay: true, showAs: 'busy', isCancelled: true })),
    ).toBe(false);
  });
});

describe('blocksByDay', () => {
  it('treats the all-day end date as exclusive', () => {
    // Graph renders "Mon and Tue off" as 26 → 28.
    const m = blocksByDay([
      ev({
        isAllDay: true,
        showAs: 'oof',
        subject: 'Annual leave',
        start: { dateTime: '2026-10-26T00:00:00.0000000', timeZone: 'x' },
        end: { dateTime: '2026-10-28T00:00:00.0000000', timeZone: 'x' },
      }),
    ]);
    expect([...m.keys()].sort()).toEqual(['2026-10-26', '2026-10-27']);
    expect(m.get('2026-10-26')!.allDay).toBe(true);
    expect(m.get('2026-10-26')!.labels).toEqual(['Annual leave']);
  });

  it('measures a timed OOF in wall-clock hours', () => {
    const m = blocksByDay([
      ev({
        showAs: 'oof',
        start: { dateTime: '2026-10-26T09:00:00.0000000', timeZone: 'x' },
        end: { dateTime: '2026-10-26T12:30:00.0000000', timeZone: 'x' },
      }),
    ]);
    expect(m.get('2026-10-26')!.hours).toBe(3.5);
    expect(m.get('2026-10-26')!.allDay).toBe(false);
  });

  it('adds up several blocks on one day', () => {
    const m = blocksByDay([
      ev({
        showAs: 'oof',
        subject: 'Dentist',
        start: { dateTime: '2026-10-26T09:00:00.0000000', timeZone: 'x' },
        end: { dateTime: '2026-10-26T11:00:00.0000000', timeZone: 'x' },
      }),
      ev({
        showAs: 'oof',
        subject: 'School run',
        start: { dateTime: '2026-10-26T15:00:00.0000000', timeZone: 'x' },
        end: { dateTime: '2026-10-26T16:00:00.0000000', timeZone: 'x' },
      }),
      ev({ showAs: 'busy', subject: 'Standup' }), // ignored
    ]);
    expect(m.get('2026-10-26')!.hours).toBe(3);
    expect(m.get('2026-10-26')!.labels).toEqual(['Dentist', 'School run']);
  });

  it('splits a timed block that straddles midnight', () => {
    const m = blocksByDay([
      ev({
        showAs: 'oof',
        start: { dateTime: '2026-10-26T22:00:00.0000000', timeZone: 'x' },
        end: { dateTime: '2026-10-28T06:00:00.0000000', timeZone: 'x' },
      }),
    ]);
    expect(m.get('2026-10-26')!.hours).toBe(2);
    expect(m.get('2026-10-27')!.allDay).toBe(true); // whole middle day
    expect(m.get('2026-10-28')!.hours).toBe(6);
  });

  it('does not spill a midnight end onto the next day', () => {
    const m = blocksByDay([
      ev({
        showAs: 'oof',
        start: { dateTime: '2026-10-26T13:00:00.0000000', timeZone: 'x' },
        end: { dateTime: '2026-10-27T00:00:00.0000000', timeZone: 'x' },
      }),
    ]);
    expect(m.get('2026-10-26')!.hours).toBe(11);
    expect(m.has('2026-10-27')).toBe(false);
  });

  it('returns nothing for a calendar of ordinary meetings', () => {
    const m = blocksByDay([ev({}), ev({ showAs: 'busy' }), ev({ showAs: 'tentative' })]);
    expect(m.size).toBe(0);
  });
});

describe('planSync — Q2, fill blanks only', () => {
  const noRows = new Map<string, ExistingRow>();

  it('writes the remaining hours on a blank day', () => {
    const plan = planSync({
      days: week,
      blocks: blocksByDay([
        ev({
          showAs: 'oof',
          subject: 'Specialist',
          start: { dateTime: '2026-10-26T09:00:00.0000000', timeZone: 'x' },
          end: { dateTime: '2026-10-26T12:00:00.0000000', timeZone: 'x' },
        }),
      ]),
      existing: noRows,
      baselineHoursFor: eightHourWeekday,
    });
    expect(plan.writes).toEqual([
      { dateIso: '2026-10-26', hours: 5, labels: ['Specialist'] },
    ]);
  });

  it('zeroes a day taken by an all-day event', () => {
    const plan = planSync({
      days: week,
      blocks: blocksByDay([
        ev({
          isAllDay: true,
          showAs: 'oof',
          start: { dateTime: '2026-10-28T00:00:00.0000000', timeZone: 'x' },
          end: { dateTime: '2026-10-29T00:00:00.0000000', timeZone: 'x' },
        }),
      ]),
      existing: noRows,
      baselineHoursFor: eightHourWeekday,
    });
    expect(plan.writes).toEqual([
      { dateIso: '2026-10-28', hours: 0, labels: ['Event'] },
    ]);
  });

  it('never overwrites a day the person forecast themselves', () => {
    const plan = planSync({
      days: week,
      blocks: blocksByDay([
        ev({
          isAllDay: true,
          showAs: 'oof',
          start: { dateTime: '2026-10-26T00:00:00.0000000', timeZone: 'x' },
          end: { dateTime: '2026-10-27T00:00:00.0000000', timeZone: 'x' },
        }),
      ]),
      existing: new Map([['2026-10-26', { hours: 8, source: 'human' }]]),
      baselineHoursFor: eightHourWeekday,
    });
    expect(plan.writes).toEqual([]);
    expect(plan.skippedHuman).toEqual(['2026-10-26']);
  });

  it('refreshes its own earlier row when the calendar changes', () => {
    const plan = planSync({
      days: week,
      blocks: blocksByDay([
        ev({
          showAs: 'oof',
          start: { dateTime: '2026-10-26T09:00:00.0000000', timeZone: 'x' },
          end: { dateTime: '2026-10-26T13:00:00.0000000', timeZone: 'x' },
        }),
      ]),
      existing: new Map([['2026-10-26', { hours: 0, source: 'outlook' }]]),
      baselineHoursFor: eightHourWeekday,
    });
    expect(plan.writes[0]).toMatchObject({ dateIso: '2026-10-26', hours: 4 });
  });

  it('leaves its own row alone when nothing changed', () => {
    const plan = planSync({
      days: week,
      blocks: blocksByDay([
        ev({
          isAllDay: true,
          showAs: 'oof',
          start: { dateTime: '2026-10-26T00:00:00.0000000', timeZone: 'x' },
          end: { dateTime: '2026-10-27T00:00:00.0000000', timeZone: 'x' },
        }),
      ]),
      existing: new Map([['2026-10-26', { hours: 0, source: 'outlook' }]]),
      baselineHoursFor: eightHourWeekday,
    });
    expect(plan.writes).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it('deletes a synced day whose event has gone away', () => {
    // Leave cancelled. Leaving the row behind would strand a phantom
    // day off in the forecast forever.
    const plan = planSync({
      days: week,
      blocks: new Map(),
      existing: new Map([['2026-10-28', { hours: 0, source: 'outlook' }]]),
      baselineHoursFor: eightHourWeekday,
    });
    expect(plan.deletes).toEqual(['2026-10-28']);
    expect(plan.writes).toEqual([]);
  });

  it('does not delete a human row that has no calendar event', () => {
    const plan = planSync({
      days: week,
      blocks: new Map(),
      existing: new Map([['2026-10-28', { hours: 6, source: 'human' }]]),
      baselineHoursFor: eightHourWeekday,
    });
    expect(plan.deletes).toEqual([]);
    expect(plan.skippedHuman).toEqual([]); // nothing to skip — no event
  });

  it('skips a non-working day rather than writing a zero', () => {
    // A weekend OOF tells us nothing: they were not working anyway,
    // and a 0 row would make the day look forecast when it is not.
    const plan = planSync({
      days: week,
      blocks: blocksByDay([
        ev({
          isAllDay: true,
          showAs: 'oof',
          start: { dateTime: '2026-10-31T00:00:00.0000000', timeZone: 'x' },
          end: { dateTime: '2026-11-02T00:00:00.0000000', timeZone: 'x' },
        }),
      ]),
      existing: noRows,
      baselineHoursFor: eightHourWeekday,
    });
    expect(plan.writes).toEqual([]);
  });

  it('never writes more hours than the person works that day', () => {
    const plan = planSync({
      days: ['2026-10-26'],
      blocks: blocksByDay([
        ev({
          showAs: 'oof',
          start: { dateTime: '2026-10-26T06:00:00.0000000', timeZone: 'x' },
          end: { dateTime: '2026-10-26T23:00:00.0000000', timeZone: 'x' },
        }),
      ]),
      existing: noRows,
      baselineHoursFor: () => 8,
    });
    expect(plan.writes[0]!.hours).toBe(0); // 8 - 17, floored at zero
  });

  it('treats a block of zero hours as nothing at all', () => {
    // Unreachable through blocksByDay, which is the point — if a
    // future change lets an empty entry through, "0 hours blocked"
    // must not become "forecast a full working day".
    const plan = planSync({
      days: ['2026-10-26'],
      blocks: new Map([['2026-10-26', { allDay: false, hours: 0, labels: [] }]]),
      existing: noRows,
      baselineHoursFor: () => 8,
    });
    expect(plan.writes).toEqual([]);
  });

  it('ignores days outside the horizon it was handed', () => {
    const plan = planSync({
      days: ['2026-10-26'],
      blocks: blocksByDay([
        ev({
          isAllDay: true,
          showAs: 'oof',
          start: { dateTime: '2026-12-01T00:00:00.0000000', timeZone: 'x' },
          end: { dateTime: '2026-12-02T00:00:00.0000000', timeZone: 'x' },
        }),
      ]),
      existing: noRows,
      baselineHoursFor: () => 8,
    });
    expect(plan.writes).toEqual([]);
  });
});

describe('baselineHoursForPerson', () => {
  const base = {
    fte: 1,
    regularDaysEnabled: false,
    regularMonHours: 0,
    regularTueHours: 0,
    regularWedHours: 0,
    regularThuHours: 0,
    regularFriHours: 0,
    regularSatHours: 0,
    regularSunHours: 0,
  };
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('spreads FTE across Mon–Fri when there is no standing schedule', () => {
    expect(baselineHoursForPerson(base, d('2026-10-26'))).toBe(8); // 38/5
    expect(baselineHoursForPerson({ ...base, fte: 0.5 }, d('2026-10-26'))).toBe(4);
    expect(baselineHoursForPerson(base, d('2026-10-31'))).toBe(0); // Sat
  });

  it('prefers the standing schedule when the person has declared one', () => {
    const p = {
      ...base,
      regularDaysEnabled: true,
      regularMonHours: 0, // they don't work Mondays
      regularTueHours: 7,
      regularSatHours: 4, // but they do work Saturdays
    };
    expect(baselineHoursForPerson(p, d('2026-10-26'))).toBe(0);
    expect(baselineHoursForPerson(p, d('2026-10-27'))).toBe(7);
    expect(baselineHoursForPerson(p, d('2026-10-31'))).toBe(4);
  });
});
