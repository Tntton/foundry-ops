/**
 * Which timesheet days can still be typed into.
 *
 * Lives in `lib/` rather than `server/timesheet.ts` so the client grid can
 * import the real rule instead of re-implementing it — `server/timesheet.ts`
 * pulls in Prisma and must not reach the browser bundle.
 *
 * This mirrors the server guard in `saveTimesheet`:
 *
 *     const isLocked = existing.status === 'approved';
 *     if (isLocked && !isSuperAdmin) continue;
 *
 * Keeping the two in step is the whole point. The grid used to decide
 * editability per ROW, from a status that collapsed to `mixed` the moment a
 * row straddled an approval boundary — so on a row that was approved for
 * Monday and draft for Friday, Monday rendered as an open input and the save
 * silently dropped whatever was typed into it. Stepping back through earlier
 * weeks to check something is exactly when a person meets that row.
 */

export type LockableCell = {
  /** Display status of the entry behind the day; null when nothing is logged. */
  status: 'draft' | 'submitted' | 'approved' | 'billed' | null;
  /** Either billing leg has consumed the hour (client invoice or contractor bill). */
  billed: boolean;
};

/**
 * `true` when the day is still editable in the grid.
 *
 *   - on a document (invoice or contractor bill) → never, for anyone; the
 *     document has to be voided first
 *   - approved → super-admin only, via the existing override that preserves
 *     the original approver and timestamp
 *   - draft / submitted / empty → yes
 */
export function isCellEditable(
  cell: LockableCell,
  isSuperAdmin: boolean,
): boolean {
  if (cell.billed) return false;
  if (cell.status === 'approved' || cell.status === 'billed') {
    return isSuperAdmin;
  }
  return true;
}

/** Days with hours on them that this viewer cannot change. */
export function countLockedCells(
  cells: readonly (LockableCell & { hours: number })[],
  isSuperAdmin: boolean,
): number {
  return cells.filter((c) => c.hours > 0 && !isCellEditable(c, isSuperAdmin))
    .length;
}
