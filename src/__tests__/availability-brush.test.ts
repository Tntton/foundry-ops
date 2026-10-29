import { describe, it, expect } from 'vitest';
import {
  applyMove,
  applyPaint,
  rangeDateIsos,
  resolveBrush,
  type CellMaps,
} from '@/app/(app)/availability/availability-brush';

const cells = [
  { dateIso: '2026-10-26' }, // Mon
  { dateIso: '2026-10-27' },
  { dateIso: '2026-10-28' },
  { dateIso: '2026-10-29' },
  { dateIso: '2026-10-30' },
  { dateIso: '2026-10-31' }, // Sat
  { dateIso: '2026-11-01' }, // Sun
];

const blank = (): CellMaps => ({
  hours: Object.fromEntries(cells.map((c) => [c.dateIso, ''])),
  projects: Object.fromEntries(cells.map((c) => [c.dateIso, ''])),
});

describe('resolveBrush', () => {
  it('resolves hours + project for a normal paint', () => {
    expect(resolveBrush('8', 'GEN003', false)).toEqual({
      hours: 8,
      projectCode: 'GEN003',
    });
  });

  it('treats a zero brush as an erase, dropping the project', () => {
    // Otherwise a 0h brush with a project selected would write
    // "0h on GEN003" — a dangling allocation.
    expect(resolveBrush('0', 'GEN003', false)).toEqual({
      hours: null,
      projectCode: '',
    });
  });

  it('erasing ignores whatever the hours and project controls say', () => {
    expect(resolveBrush('8', 'GEN003', true)).toEqual({
      hours: null,
      projectCode: '',
    });
  });

  it('clamps to 0–24 and rounds to whole hours (the DB column is Int)', () => {
    expect(resolveBrush('30', '', false).hours).toBe(24);
    expect(resolveBrush('7.6', '', false).hours).toBe(8);
    expect(resolveBrush('-5', '', false).hours).toBe(null);
    expect(resolveBrush('abc', '', false).hours).toBe(null);
  });
});

describe('rangeDateIsos', () => {
  it('covers the inclusive run between anchor and cursor', () => {
    expect(rangeDateIsos(cells, 1, 3)).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
    ]);
  });

  it('is direction-agnostic — right-to-left paints the same run', () => {
    expect(rangeDateIsos(cells, 3, 1)).toEqual(rangeDateIsos(cells, 1, 3));
  });

  it('is a single day when anchor and cursor match', () => {
    expect(rangeDateIsos(cells, 2, 2)).toEqual(['2026-10-28']);
  });

  it('clamps indices that fall outside the horizon', () => {
    expect(rangeDateIsos(cells, -4, 99)).toHaveLength(cells.length);
  });
});

describe('applyPaint', () => {
  it('writes hours and project across the whole run', () => {
    const next = applyPaint(blank(), rangeDateIsos(cells, 0, 4), {
      hours: 8,
      projectCode: 'GEN003',
    });
    expect(next.hours['2026-10-26']).toBe('8');
    expect(next.hours['2026-10-30']).toBe('8');
    expect(next.projects['2026-10-28']).toBe('GEN003');
    // Weekend untouched — the drag stopped on Friday.
    expect(next.hours['2026-10-31']).toBe('');
  });

  it('erasing blanks the hours and drops the project link', () => {
    const painted = applyPaint(blank(), ['2026-10-26', '2026-10-27'], {
      hours: 8,
      projectCode: 'GEN003',
    });
    const erased = applyPaint(painted, ['2026-10-26'], {
      hours: null,
      projectCode: '',
    });
    expect(erased.hours['2026-10-26']).toBe('');
    expect(erased.projects['2026-10-26']).toBe('');
    // The rest of the earlier run survives.
    expect(erased.hours['2026-10-27']).toBe('8');
    expect(erased.projects['2026-10-27']).toBe('GEN003');
  });

  it('does not mutate the maps it was given', () => {
    const before = blank();
    applyPaint(before, ['2026-10-26'], { hours: 8, projectCode: '' });
    expect(before.hours['2026-10-26']).toBe('');
  });

  it('is a no-op on an empty run', () => {
    const before = blank();
    expect(applyPaint(before, [], { hours: 8, projectCode: '' })).toBe(before);
  });
});

describe('applyMove', () => {
  it('moves hours and project, clearing the source', () => {
    const painted = applyPaint(blank(), ['2026-10-27'], {
      hours: 6,
      projectCode: 'FHP001',
    });
    const moved = applyMove(painted, '2026-10-27', '2026-10-29');
    expect(moved.hours['2026-10-27']).toBe('');
    expect(moved.projects['2026-10-27']).toBe('');
    expect(moved.hours['2026-10-29']).toBe('6');
    expect(moved.projects['2026-10-29']).toBe('FHP001');
  });

  it('overwrites an occupied target day', () => {
    let m = applyPaint(blank(), ['2026-10-27'], { hours: 6, projectCode: 'A' });
    m = applyPaint(m, ['2026-10-29'], { hours: 3, projectCode: 'B' });
    const moved = applyMove(m, '2026-10-27', '2026-10-29');
    expect(moved.hours['2026-10-29']).toBe('6');
    expect(moved.projects['2026-10-29']).toBe('A');
    expect(moved.hours['2026-10-27']).toBe('');
  });

  it('is a no-op when dropped back on the source day', () => {
    const painted = applyPaint(blank(), ['2026-10-27'], {
      hours: 6,
      projectCode: 'A',
    });
    expect(applyMove(painted, '2026-10-27', '2026-10-27')).toBe(painted);
  });
});
