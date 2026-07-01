/**
 * Australian financial year helpers.
 *
 * AU FY runs 1 July → 30 June. Naming follows ATO convention:
 * "FY26" = 1 July 2025 → 30 June 2026 (the year ending 30 June 2026).
 *
 * Used by:
 *   - Receipt-upload project picker (`/bills/intake`) — surfaces
 *     archived projects that closed within the current FY so a late-
 *     arriving receipt can still be matched against the right job.
 *   - Anything else that needs to bucket activity by FY (TBD).
 */

/**
 * 00:00 local time on 1 July of the current AU financial year.
 *
 *   - 2026-05-10 → 2025-07-01 (currently in FY26)
 *   - 2026-08-15 → 2026-07-01 (rolled into FY27)
 */
export function startOfCurrentAuFy(now: Date = new Date()): Date {
  const year = now.getFullYear();
  // getMonth() returns 0..11 (Jan=0). July = 6.
  if (now.getMonth() >= 6) return new Date(year, 6, 1);
  return new Date(year - 1, 6, 1);
}

/**
 * 00:00 local time on 1 July of the *next* AU FY — i.e. the exclusive
 * upper bound of the current FY when used in `lt`-style filters.
 */
export function startOfNextAuFy(now: Date = new Date()): Date {
  const start = startOfCurrentAuFy(now);
  return new Date(start.getFullYear() + 1, 6, 1);
}

/**
 * Short FY label like "FY26" for the FY that contains `now`. Useful
 * for chips and select-option subtitles.
 */
export function currentAuFyLabel(now: Date = new Date()): string {
  const start = startOfCurrentAuFy(now);
  // FY label = year-ending = start.year + 1
  const ending = start.getFullYear() + 1;
  return `FY${String(ending).slice(-2)}`;
}

/**
 * Returns the FY containing `date` as the year-ending integer. E.g.
 * 2025-09-12 → 2026 (in FY26). Used for grouping archived projects
 * onto a per-FY review surface.
 */
export function auFyOf(date: Date): number {
  const y = date.getFullYear();
  return date.getMonth() >= 6 ? y + 1 : y;
}

/** Short label for an arbitrary FY year-ending. 2026 → "FY26". */
export function auFyLabel(yearEnding: number): string {
  return `FY${String(yearEnding).slice(-2)}`;
}

/**
 * Half-open date window [from, to) for an arbitrary AU FY. Suitable for
 * `where: { date: { gte: from, lt: to } }` Prisma filters.
 *
 * FY26 → { from: 2025-07-01, to: 2026-07-01 }.
 */
export function auFyWindow(yearEnding: number): { from: Date; to: Date } {
  return {
    from: new Date(yearEnding - 1, 6, 1),
    to: new Date(yearEnding, 6, 1),
  };
}
