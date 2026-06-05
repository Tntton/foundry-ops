import type { TimesheetRow } from '@/server/timesheet';
import type { TimesheetPrefillPayload } from './schemas';
import { formatIsoDate } from '@/lib/week';

/**
 * Merge a timesheet prefill payload into an existing row set.
 *
 * Pure function — given the rows the page already fetched + the
 * payload + the visible date cells + an index of allProjects, returns
 * an enriched copy of `rows` with prefilled hours added.
 *
 * Behaviour:
 *  - Entry whose date falls inside the visible range and whose
 *    project is on the row already → hours ADDED to the existing cell
 *    (so you can stack "log 1h then another 1h"), description set if
 *    one was provided AND the row's description is blank.
 *  - Entry whose project isn't on the rows yet → a new row appended
 *    with all-zero cells except the prefilled date.
 *  - Entry whose date falls OUTSIDE the visible range → recorded in
 *    `ignored` so the banner can flag it.
 *  - Entry for an unknown project code → recorded in `ignored`.
 *  - Locked rows (status not in {draft, mixed}) — we skip them rather
 *    than mutating; the grid won't accept input on locked cells anyway.
 *
 * The visible `cells` array is the canonical Date layout for the
 * Grid; we walk it to find the matching index per ISO date.
 */
export type ApplyTimesheetPrefillResult = {
  rows: TimesheetRow[];
  applied: Array<{ projectCode: string; dateIso: string; hours: number }>;
  ignored: Array<{ projectCode: string; dateIso: string; reason: string }>;
};

export function applyTimesheetPrefill(
  rows: readonly TimesheetRow[],
  payload: TimesheetPrefillPayload,
  cells: readonly Date[],
  projectIndex: ReadonlyArray<{
    id: string;
    code: string;
    name: string;
    stage: TimesheetRow['projectStage'];
  }>,
): ApplyTimesheetPrefillResult {
  const cellIsoIndex = new Map<string, number>();
  cells.forEach((d, i) => {
    cellIsoIndex.set(formatIsoDate(d), i);
  });

  const projectsByCode = new Map<string, (typeof projectIndex)[number]>(
    projectIndex.map((p) => [p.code, p]),
  );

  // Mutable working copy of rows.
  const working: TimesheetRow[] = rows.map((r) => ({
    ...r,
    cells: r.cells.map((c) => ({ ...c })),
  }));
  const rowByProjectId = new Map<string, number>(
    working.map((r, i) => [r.projectId, i] as const),
  );

  const applied: ApplyTimesheetPrefillResult['applied'] = [];
  const ignored: ApplyTimesheetPrefillResult['ignored'] = [];

  for (const entry of payload.entries) {
    const code = entry.projectCode.toUpperCase();
    const project = projectsByCode.get(code);
    if (!project) {
      ignored.push({
        projectCode: code,
        dateIso: entry.dateIso,
        reason: 'unknown_project',
      });
      continue;
    }
    const dayIdx = cellIsoIndex.get(entry.dateIso);
    if (dayIdx === undefined) {
      ignored.push({
        projectCode: code,
        dateIso: entry.dateIso,
        reason: 'outside_visible_range',
      });
      continue;
    }
    let rowIdx = rowByProjectId.get(project.id);
    if (rowIdx === undefined) {
      const newRow: TimesheetRow = {
        projectId: project.id,
        projectCode: project.code,
        projectName: project.name,
        projectStage: project.stage,
        description: entry.notes ?? '',
        status: 'draft',
        cells: cells.map((date) => ({ date, hours: 0 })),
      };
      working.push(newRow);
      rowIdx = working.length - 1;
      rowByProjectId.set(project.id, rowIdx);
    }
    const row = working[rowIdx]!;
    if (row.status === 'approved' || row.status === 'billed') {
      ignored.push({
        projectCode: code,
        dateIso: entry.dateIso,
        reason: 'locked_row',
      });
      continue;
    }
    const cell = row.cells[dayIdx]!;
    cell.hours = Number((cell.hours + entry.hours).toFixed(2));
    if (entry.notes && row.description.trim().length === 0) {
      row.description = entry.notes;
    }
    applied.push({
      projectCode: code,
      dateIso: entry.dateIso,
      hours: entry.hours,
    });
  }
  return { rows: working, applied, ignored };
}
