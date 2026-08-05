/**
 * Snap timesheet hours to the nearest 0.25 (15 minutes) — the grid's
 * granularity. Users typing odd values (e.g. 0.65) get rounded to the
 * nearest quarter-hour. Was 0.5 (half-hour), which blocked 15-minute
 * entries (feedback — Shea).
 *
 * Lives in lib (not the `'use server'` actions file, which may only
 * export async functions) so it can be shared + unit-tested.
 */
export function snapToQuarterHour(n: number): number {
  return Math.round(n * 4) / 4;
}
