import { describe, it, expect } from 'vitest';
import { applyAvailabilityPrefill } from '@/server/agents/assistant/prefill/apply-availability';
import type { AvailabilityDayInput } from '@/app/(app)/availability/availability-editor';

// A minimal 1-week horizon (Mon 2026-06-01 → Sun 2026-06-07).
const cells: AvailabilityDayInput[] = Array.from({ length: 7 }, (_, i) => {
  const iso = `2026-06-0${i + 1}`;
  return { dateIso: iso, hours: null, notes: null, projectId: null };
});

describe('applyAvailabilityPrefill', () => {
  it('overwrites hours on matching dates and logs them as applied', () => {
    const result = applyAvailabilityPrefill(cells, {
      entries: [
        { dateIso: '2026-06-01', hours: 4 },
        { dateIso: '2026-06-02', hours: 6 },
      ],
    });
    expect(result.applied).toHaveLength(2);
    expect(result.ignored).toHaveLength(0);
    expect(result.cells[0]!.hours).toBe(4);
    expect(result.cells[1]!.hours).toBe(6);
    // Untouched days stay null.
    expect(result.cells[2]!.hours).toBeNull();
  });

  it('overwrites rather than accumulates (forecast, not a log)', () => {
    const seeded = cells.map((c) =>
      c.dateIso === '2026-06-03' ? { ...c, hours: 8 } : c,
    );
    const result = applyAvailabilityPrefill(seeded, {
      entries: [{ dateIso: '2026-06-03', hours: 2 }],
    });
    expect(result.cells[2]!.hours).toBe(2);
  });

  it('records dates outside the horizon as ignored and leaves cells intact', () => {
    const result = applyAvailabilityPrefill(cells, {
      entries: [
        { dateIso: '2026-06-01', hours: 3 },
        { dateIso: '2026-12-25', hours: 8 },
      ],
    });
    expect(result.applied).toEqual([{ dateIso: '2026-06-01', hours: 3 }]);
    expect(result.ignored).toEqual([
      { dateIso: '2026-12-25', reason: 'outside_horizon' },
    ]);
  });

  it('does not mutate the input cells array', () => {
    const before = JSON.stringify(cells);
    applyAvailabilityPrefill(cells, {
      entries: [{ dateIso: '2026-06-01', hours: 5 }],
    });
    expect(JSON.stringify(cells)).toBe(before);
  });

  it('keeps a single applied entry (last value wins) for a duplicated date', () => {
    const result = applyAvailabilityPrefill(cells, {
      entries: [
        { dateIso: '2026-06-04', hours: 3 },
        { dateIso: '2026-06-04', hours: 7 },
      ],
    });
    expect(result.applied).toEqual([{ dateIso: '2026-06-04', hours: 7 }]);
    expect(result.cells[3]!.hours).toBe(7);
  });
});
