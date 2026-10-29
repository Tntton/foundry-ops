/**
 * Which timesheet days can still be typed into.
 *
 * Lives in `lib/` rather than `server/timesheet.ts` so the client grid can
 * import the real rule instead of re-implementing it — `server/timesheet.ts`
 * pulls in Prisma and must not reach the browser bundle.
 *
 * The grid, the assistant prefill and the `saveTimesheet` guard all call this
 * one function, so a day that renders locked is a day the save refuses, and
 * the other way round. They used to drift: the grid decided editability per
 * ROW, from a status that collapsed to `mixed` the moment a row straddled an
 * approval boundary — so on a row approved for Monday and draft for Friday,
 * Monday rendered as an open input and the save silently dropped whatever was
 * typed into it (TASK-514). Stepping back through earlier weeks to check
 * something is exactly when a person meets that row.
 */

/**
 * State of the `TimesheetPeriod` the day falls inside, when it has moved past
 * `open` / `lodged`. The month-level lock is the one an entry-level check
 * cannot see: an `invoiced` month whose days hold no entry at all still
 * accepted brand-new hours, because there was no existing row to refuse
 * (TASK-523).
 */
export type PeriodLock = 'approved' | 'invoiced' | null;

export type LockableCell = {
  /** Display status of the entry behind the day; null when nothing is logged. */
  status: 'draft' | 'submitted' | 'approved' | 'billed' | null;
  /** Either billing leg has consumed the hour (client invoice or contractor bill). */
  billed: boolean;
  /** Lodgement state of the month this day sits in. Absent = `open` / `lodged`. */
  periodLock?: PeriodLock;
};

/**
 * `true` when the day is still editable in the grid.
 *
 *   - on a document (invoice or contractor bill) → never, for anyone; the
 *     document has to be voided first
 *   - in an `invoiced` month → never, for anyone, empty days included; the
 *     month has to be reopened. Terminal everywhere else in the codebase
 *     (`lodgeMonth`, `decideTimesheetEntries`), so it is terminal here too
 *   - in an `approved` month, or on an approved entry → super-admin only, via
 *     the existing override that preserves the original approver and timestamp
 *   - draft / submitted / empty → yes
 */
export function isCellEditable(
  cell: LockableCell,
  isSuperAdmin: boolean,
): boolean {
  if (cell.billed) return false;
  if (cell.periodLock === 'invoiced') return false;
  if (cell.periodLock === 'approved') return isSuperAdmin;
  if (cell.status === 'approved' || cell.status === 'billed') {
    return isSuperAdmin;
  }
  return true;
}

/**
 * Why the day is locked, in the words the grid and the save-time error both
 * use. `null` when the day is editable for this viewer.
 *
 * Ordered to match `isCellEditable` — the document lock is reported ahead of
 * the month lock because voiding the document is the action that unblocks it.
 */
export function cellLockKind(
  cell: LockableCell,
  isSuperAdmin: boolean,
): 'billed' | 'period_invoiced' | 'period_approved' | 'approved' | null {
  if (isCellEditable(cell, isSuperAdmin)) return null;
  if (cell.billed) return 'billed';
  if (cell.periodLock === 'invoiced') return 'period_invoiced';
  if (cell.periodLock === 'approved') return 'period_approved';
  return 'approved';
}

/** Days with hours on them that this viewer cannot change. */
export function countLockedCells(
  cells: readonly (LockableCell & { hours: number })[],
  isSuperAdmin: boolean,
): number {
  return cells.filter((c) => c.hours > 0 && !isCellEditable(c, isSuperAdmin))
    .length;
}
