import { describe, it, expect } from 'vitest';
import { applyTimesheetPrefill } from '@/server/agents/assistant/prefill/apply-timesheet';
import type { TimesheetRow } from '@/server/timesheet';

const monday = new Date('2026-06-01T00:00:00.000Z');
const cells = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + i);
  return d;
});

const projectIndex = [
  { id: 'pj_cac', code: 'CAC001', name: 'CAC discovery', stage: 'delivery' as const },
  { id: 'pj_gnc', code: 'GNC002', name: 'GNC pricing', stage: 'kickoff' as const },
  { id: 'pj_arc', code: 'ARC999', name: 'Old archived', stage: 'archived' as const },
];

const blankRow = (
  projectId: string,
  code: string,
  stage: TimesheetRow['projectStage'] = 'delivery',
): TimesheetRow => ({
  projectId,
  projectCode: code,
  projectName: code,
  projectStage: stage,
  description: '',
  status: 'draft',
  cells: cells.map((date) => ({ date, hours: 0 })),
});

describe('applyTimesheetPrefill', () => {
  it('adds hours to an existing row on the matching day', () => {
    const rows: TimesheetRow[] = [blankRow('pj_cac', 'CAC001')];
    const result = applyTimesheetPrefill(
      rows,
      { entries: [{ projectCode: 'CAC001', dateIso: '2026-06-02', hours: 3 }] },
      cells,
      projectIndex,
    );
    expect(result.applied).toHaveLength(1);
    expect(result.ignored).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.cells[1]!.hours).toBe(3);
  });

  it('appends a new row when the project is not on the sheet yet', () => {
    const rows: TimesheetRow[] = [blankRow('pj_cac', 'CAC001')];
    const result = applyTimesheetPrefill(
      rows,
      { entries: [{ projectCode: 'GNC002', dateIso: '2026-06-03', hours: 2, notes: 'discovery' }] },
      cells,
      projectIndex,
    );
    expect(result.rows).toHaveLength(2);
    const added = result.rows[1]!;
    expect(added.projectId).toBe('pj_gnc');
    expect(added.cells[2]!.hours).toBe(2);
    expect(added.description).toBe('discovery');
  });

  it('stacks hours on the SAME cell across multiple entries', () => {
    const rows: TimesheetRow[] = [blankRow('pj_cac', 'CAC001')];
    const result = applyTimesheetPrefill(
      rows,
      {
        entries: [
          { projectCode: 'CAC001', dateIso: '2026-06-02', hours: 1 },
          { projectCode: 'CAC001', dateIso: '2026-06-02', hours: 2 },
        ],
      },
      cells,
      projectIndex,
    );
    expect(result.rows[0]!.cells[1]!.hours).toBe(3);
    expect(result.applied).toHaveLength(2);
  });

  it('ignores entries with an unknown project code', () => {
    const result = applyTimesheetPrefill(
      [],
      {
        entries: [{ projectCode: 'ZZZ999', dateIso: '2026-06-02', hours: 4 }],
      },
      cells,
      projectIndex,
    );
    expect(result.applied).toHaveLength(0);
    expect(result.ignored).toEqual([
      { projectCode: 'ZZZ999', dateIso: '2026-06-02', reason: 'unknown_project' },
    ]);
  });

  it('ignores entries whose date is outside the visible range', () => {
    const result = applyTimesheetPrefill(
      [],
      {
        entries: [{ projectCode: 'CAC001', dateIso: '2026-07-15', hours: 4 }],
      },
      cells,
      projectIndex,
    );
    expect(result.applied).toHaveLength(0);
    expect(result.ignored[0]!.reason).toBe('outside_visible_range');
  });

  it('does not mutate the input rows', () => {
    const rows: TimesheetRow[] = [blankRow('pj_cac', 'CAC001')];
    applyTimesheetPrefill(
      rows,
      { entries: [{ projectCode: 'CAC001', dateIso: '2026-06-02', hours: 5 }] },
      cells,
      projectIndex,
    );
    expect(rows[0]!.cells[1]!.hours).toBe(0); // original untouched
  });

  it('refuses to touch a locked row (approved / billed)', () => {
    const locked: TimesheetRow = {
      ...blankRow('pj_cac', 'CAC001'),
      status: 'approved',
    };
    const result = applyTimesheetPrefill(
      [locked],
      { entries: [{ projectCode: 'CAC001', dateIso: '2026-06-02', hours: 3 }] },
      cells,
      projectIndex,
    );
    expect(result.applied).toHaveLength(0);
    expect(result.ignored[0]!.reason).toBe('locked_row');
    // Cell should be unchanged.
    expect(result.rows[0]!.cells[1]!.hours).toBe(0);
  });

  it('only sets description on a new row OR a blank-description row', () => {
    const rows: TimesheetRow[] = [
      { ...blankRow('pj_cac', 'CAC001'), description: 'existing note' },
    ];
    const result = applyTimesheetPrefill(
      rows,
      {
        entries: [
          { projectCode: 'CAC001', dateIso: '2026-06-02', hours: 3, notes: 'NEW' },
        ],
      },
      cells,
      projectIndex,
    );
    expect(result.rows[0]!.description).toBe('existing note');
  });
});
