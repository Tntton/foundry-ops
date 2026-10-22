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

// ─── Quarters ────────────────────────────────────────────────────────────
// Calendar quarters (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec) and AU financial
// quarters share identical boundaries — the AU FY just starts counting at
// July. So one set of helpers covers both and only the label differs.

/** Start of the calendar quarter containing `date` — 1 Jan / Apr / Jul / Oct, UTC. */
export function startOfQuarter(date: Date): Date {
  const m = date.getUTCMonth();
  return new Date(Date.UTC(date.getUTCFullYear(), m - (m % 3), 1));
}

/** The three month-starts inside a quarter, in order. */
export function quarterMonths(quarterStart: Date): Date[] {
  const q = startOfQuarter(quarterStart);
  return [0, 1, 2].map((i) => addMonths(q, i));
}

/** Shift by whole quarters, staying on the 1st of the quarter's first month. */
export function addQuarters(quarterStart: Date, delta: number): Date {
  return addMonths(startOfQuarter(quarterStart), delta * 3);
}

/**
 * AU financial-year quarter number, 1-based from July.
 * Jul–Sep = Q1, Oct–Dec = Q2, Jan–Mar = Q3, Apr–Jun = Q4.
 */
export function auFyQuarterNumber(quarterStart: Date): number {
  const m = startOfQuarter(quarterStart).getUTCMonth();
  return (((m - 6) / 3 + 4) % 4) + 1;
}

/** AU FY containing the quarter, as the year-ending integer (FY27 → 2027). */
export function auFyOfQuarter(quarterStart: Date): number {
  const q = startOfQuarter(quarterStart);
  const y = q.getUTCFullYear();
  return q.getUTCMonth() >= 6 ? y + 1 : y;
}

/**
 * Fixed three-letter month abbreviations.
 *
 * `Intl` with `month: 'short'` is not uniform — en-AU returns "July",
 * "Sept" and "June" alongside "Aug" and "Oct", which makes a row of month
 * column headers ragged and the width of a quarter label unpredictable. The
 * abbreviations below are the same width every month and don't move with the
 * ICU version.
 */
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * "Jul–Sep 2026 · FY27 Q1" — names both the calendar months a person
 * recognises and the FY quarter finance reports against.
 */
export function formatQuarterLabel(quarterStart: Date): string {
  const months = quarterMonths(quarterStart);
  const first = months[0]!;
  const last = months[2]!;
  const fy = auFyOfQuarter(first);
  return `${MONTH_ABBR[first.getUTCMonth()]}–${MONTH_ABBR[last.getUTCMonth()]} ${first.getUTCFullYear()} · FY${String(fy).slice(-2)} Q${auFyQuarterNumber(first)}`;
}

/** Short month label for a quarter column header — "Aug 2026". */
export function formatMonthShortLabel(monthStart: Date): string {
  return `${MONTH_ABBR[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`;
}
