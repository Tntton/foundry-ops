import { describe, it, expect } from 'vitest';
import { snapToQuarterHour } from '@/lib/timesheet-hours';

describe('snapToQuarterHour', () => {
  it('keeps exact quarter-hour values (0.25 increments now allowed)', () => {
    expect(snapToQuarterHour(0.25)).toBe(0.25);
    expect(snapToQuarterHour(0.5)).toBe(0.5);
    expect(snapToQuarterHour(0.75)).toBe(0.75);
    expect(snapToQuarterHour(1)).toBe(1);
    expect(snapToQuarterHour(2.25)).toBe(2.25);
  });

  it('rounds odd values to the nearest quarter-hour', () => {
    expect(snapToQuarterHour(0.65)).toBe(0.75);
    expect(snapToQuarterHour(0.1)).toBe(0);
    expect(snapToQuarterHour(0.4)).toBe(0.5);
    expect(snapToQuarterHour(1.3)).toBe(1.25);
  });
});
