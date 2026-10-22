import { describe, it, expect } from 'vitest';
import { weekAnchorDay, formatIsoDate } from '@/lib/week';

const iso = (s: string) => new Date(`${s}T00:00:00.000Z`);

// The week of 2026-07-20 runs Mon 2026-07-20 → Sun 2026-07-26.
describe('weekAnchorDay', () => {
  it('parks on today when today falls inside the target week', () => {
    // "this week" entry (any date in the week) + today mid-week → today.
    const today = iso('2026-07-22'); // Wednesday
    const anchor = weekAnchorDay(iso('2026-07-20'), today);
    expect(formatIsoDate(anchor)).toBe('2026-07-22');
  });

  it("parks on the week's Monday when today is in a different week", () => {
    // "last week" entry, today is this week → that week's Monday.
    const today = iso('2026-07-22');
    const anchor = weekAnchorDay(iso('2026-07-15'), today); // prev week (Wed)
    expect(formatIsoDate(anchor)).toBe('2026-07-13'); // Mon of prev week
  });

  it('anchors any in-week reference date to the same Monday', () => {
    const today = iso('2026-01-01'); // unrelated week
    const mon = weekAnchorDay(iso('2026-07-20'), today); // Monday itself
    const sun = weekAnchorDay(iso('2026-07-26'), today); // Sunday
    expect(formatIsoDate(mon)).toBe('2026-07-20');
    expect(formatIsoDate(sun)).toBe('2026-07-20');
  });

  it('treats today on the week boundary (Mon/Sun) as inside the week', () => {
    const monday = iso('2026-07-20');
    const sunday = iso('2026-07-26');
    expect(formatIsoDate(weekAnchorDay(iso('2026-07-22'), monday))).toBe(
      '2026-07-20',
    );
    expect(formatIsoDate(weekAnchorDay(iso('2026-07-22'), sunday))).toBe(
      '2026-07-26',
    );
  });
});
