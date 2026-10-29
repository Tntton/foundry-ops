/**
 * Pure state transforms behind the calendar's two gestures. Kept out of
 * the component so the part worth testing — what a drag does to the
 * hours and project maps — is testable without a DOM.
 */

export type CellMaps = {
  /** dateIso → hours as a string ('' = blank, not zero). */
  hours: Record<string, string>;
  /** dateIso → project code ('' = Free / unallocated). */
  projects: Record<string, string>;
};

/** The resolved brush: what a paint gesture will write. */
export type Brush = {
  /** null erases the run — blank hours and no project link. */
  hours: number | null;
  projectCode: string;
};

/**
 * Resolve the brush controls into what will actually be written.
 *
 * Zero (or unparseable, or negative) hours is an erase in everything
 * but name, so it routes down the same path — otherwise a 0h brush
 * with a project selected would store "0h on GEN003", a dangling
 * allocation the save step already strips.
 */
export function resolveBrush(
  rawHours: string,
  projectCode: string,
  erasing: boolean,
): Brush {
  if (erasing) return { hours: null, projectCode: '' };
  const n = Math.round(Math.max(0, Math.min(24, Number(rawHours) || 0)));
  return n > 0 ? { hours: n, projectCode } : { hours: null, projectCode: '' };
}

/**
 * The days a drag covers. Anchor and cursor are flat indices into the
 * week-major cell list; either order works, so dragging right-to-left
 * paints the same run as left-to-right.
 */
export function rangeDateIsos(
  cells: ReadonlyArray<{ dateIso: string }>,
  anchor: number,
  cursor: number,
): string[] {
  const lo = Math.max(0, Math.min(anchor, cursor));
  const hi = Math.min(cells.length - 1, Math.max(anchor, cursor));
  if (hi < lo) return [];
  return cells.slice(lo, hi + 1).map((c) => c.dateIso);
}

/** Write the brush across a run of days. */
export function applyPaint(
  maps: CellMaps,
  dateIsos: readonly string[],
  brush: Brush,
): CellMaps {
  if (dateIsos.length === 0) return maps;
  const hours = { ...maps.hours };
  const projects = { ...maps.projects };
  for (const d of dateIsos) {
    hours[d] = brush.hours === null ? '' : String(brush.hours);
    projects[d] = brush.hours === null ? '' : brush.projectCode;
  }
  return { hours, projects };
}

/**
 * Move one day's hours and project onto another day; the source
 * clears. Dropping onto an occupied day overwrites it — the gesture
 * reads as "this work happens then instead", and Reset undoes it.
 */
export function applyMove(maps: CellMaps, fromIso: string, toIso: string): CellMaps {
  if (fromIso === toIso) return maps;
  const movedHours = maps.hours[fromIso] ?? '';
  const movedProject = maps.projects[fromIso] ?? '';
  return {
    hours: { ...maps.hours, [fromIso]: '', [toIso]: movedHours },
    projects: { ...maps.projects, [fromIso]: '', [toIso]: movedProject },
  };
}
