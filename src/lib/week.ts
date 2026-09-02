/**
 * Week helpers. Weeks run Monday → Sunday (AU convention).
 * All dates normalised to midnight UTC on the given calendar day.
 */

/**
 * "Today" as a calendar date in the firm timezone (Australia/Sydney),
 * normalised to UTC midnight. Server `new Date()` runs in UTC, which is
 * still *yesterday* until ~10-11am AEST — so anchoring "this week" on
 * raw `new Date()` lands staff on LAST week's grid every Monday
 * morning. Use this wherever "today" means the firm's calendar day.
 */
export function todayInFirmTz(): Date {
  // en-CA renders as YYYY-MM-DD, which parses cleanly below.
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${iso}T00:00:00.000Z`);
}

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

/**
 * The single day a whole-week total should be parked on. Returns the
 * reference `today` when it falls inside the week containing `dateInWeek`,
 * otherwise that week's Monday. Used when someone logs "5h this week on
 * PRP" with no specific day — the day-based timesheet still needs a
 * concrete cell, so we land it on a real, in-view day the user can then
 * redistribute.
 */
export function weekAnchorDay(dateInWeek: Date, today: Date): Date {
  const weekStart = startOfWeek(dateInWeek);
  const weekEnd = addDays(weekStart, 6);
  return today >= weekStart && today <= weekEnd ? today : weekStart;
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(s: string | undefined): Date {
  if (!s) return startOfWeek(todayInFirmTz());
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? startOfWeek(todayInFirmTz()) : d;
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ─── Calendar months ────────────────────────────────────────────────────────
//
// The month grid used to be a rolling 28-day block anchored on the current
// week (`startOfFourWeekBlock` / `fourWeekDates`, removed in TASK-501). It
// drifted against the calendar and so never once lined up with "August" —
// which made monthly lodgement impossible: a contractor cannot invoice for a
// period the app can't select. These are real calendar months, 28–31 days.

/** UTC midnight on the 1st of the month containing `date`. */
export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Days in the given month. `month` is 1-based (1 = January). */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of this one — handles leap
  // years without a special case.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Every day in the month containing `monthStart`, in order. */
export function monthDates(monthStart: Date): Date[] {
  const n = daysInMonth(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1);
  return Array.from({ length: n }, (_, i) => addDays(monthStart, i));
}

/**
 * Shift by whole months, staying on the 1st. Built from the UTC year/month
 * parts rather than `setUTCMonth` so it can't overflow (31 Jan + 1 month
 * landing on 2 or 3 March).
 */
export function addMonths(monthStart: Date, delta: number): Date {
  return new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + delta, 1),
  );
}

/** "August 2026" — the label a person recognises as their lodgement period. */
export function formatMonthLabel(monthStart: Date): string {
  return monthStart.toLocaleDateString('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** 1-based month number (1 = January), matching TimesheetPeriod.month. */
export function monthNumber(monthStart: Date): number {
  return monthStart.getUTCMonth() + 1;
}

/** Reconstruct the month start from a TimesheetPeriod's (year, month). */
export function monthStartFrom(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}
