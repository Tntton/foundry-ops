/**
 * Week helpers. Weeks run Monday → Sunday (AU convention).
 * All dates normalised to midnight UTC on the given calendar day.
 */

export function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  const offset = dow === 0 ? -6 : 1 - dow; // back to Monday
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function weekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(s: string | undefined): Date {
  if (!s) return startOfWeek(new Date());
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? startOfWeek(new Date()) : d;
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Returns the Monday that starts the block of four Mon–Sun weeks whose last
 * week contains the given date. This gives a rolling 28-day grid anchored to
 * the reference date (typically "today"), with the current week as the rightmost
 * column group — so earlier rows are historical context, the right-hand column
 * is what you're actively logging.
 */
export function startOfFourWeekBlock(reference: Date): Date {
  const currentWeekStart = startOfWeek(reference);
  return addDays(currentWeekStart, -21);
}

export function fourWeekDates(blockStart: Date): Date[] {
  return Array.from({ length: 28 }, (_, i) => addDays(blockStart, i));
}
