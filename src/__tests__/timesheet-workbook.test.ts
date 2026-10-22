import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  timesheetSheets,
  financialYearWindow,
  type TimesheetExportEntry,
} from '@/server/exports/timesheet-workbook';
import { buildWorkbookBuffer } from '@/server/exports/excel-workbook';
import type { FirmUtilisation } from '@/server/reports/utilisation';

/**
 * TASK-062 · Timesheet.xlsx. Pure grouping over fixture entries: by
 * person, by project, plus the utilisation passthrough. Also checks the
 * current+last FY window boundaries.
 */

const entries: TimesheetExportEntry[] = [
  { personId: 'p1', personName: 'Jas Navarro', personInitials: 'JN', projectCode: 'IFM001', projectName: 'Galileo', hours: 10, costCents: 500_00, billed: true },
  { personId: 'p1', personName: 'Jas Navarro', personInitials: 'JN', projectCode: 'FHP001', projectName: 'Internal', hours: 5, costCents: 250_00, billed: false },
  { personId: 'p2', personName: 'Chris Tan', personInitials: 'CT', projectCode: 'IFM001', projectName: 'Galileo', hours: 8, costCents: 480_00, billed: true },
];

const util = {
  month: '2026-07',
  monthStart: new Date('2026-07-01'),
  monthEnd: new Date('2026-08-01'),
  rows: [
    {
      personId: 'p1',
      initials: 'JN',
      firstName: 'Jas',
      lastName: 'Navarro',
      band: 'Manager',
      level: 'M2',
      employment: 'employee',
      fte: 1,
      targetHours: 160,
      loggedHours: 120,
      billedHours: 90,
      utilisationPct: 75,
      active: true,
      topProjects: [],
      headshotUrl: null,
    },
  ],
  totals: {
    activeHeadcount: 1,
    targetHours: 160,
    loggedHours: 120,
    billedHours: 90,
    utilisationPct: 75,
    billableRatePct: 75,
  },
} as FirmUtilisation;

describe('timesheetSheets', () => {
  it('produces By person / By project / Utilisation', () => {
    expect(timesheetSheets(entries, util).map((s) => s.name)).toEqual([
      'By person',
      'By project',
      'Utilisation',
    ]);
  });

  it('groups hours + cost by person and by project', () => {
    const buf = buildWorkbookBuffer(timesheetSheets(entries, util));
    const wb = XLSX.read(buf, { type: 'buffer' });
    const person = XLSX.utils.sheet_to_json(wb.Sheets['By person']!, { header: 1, blankrows: false }) as unknown[][];
    const project = XLSX.utils.sheet_to_json(wb.Sheets['By project']!, { header: 1, blankrows: false }) as unknown[][];
    // Jas: 15h total (sorted first, more hours), cost 750.00, billed 10h.
    expect(person[1]![0]).toBe('Jas Navarro');
    expect(person[1]![2]).toBe(15);
    expect(person[1]![3]).toBe(750);
    expect(person[1]![4]).toBe(10);
    // IFM001 aggregates Jas(10)+Chris(8) = 18h.
    const ifm = project.find((r) => r[0] === 'IFM001');
    expect(ifm![2]).toBe(18);
  });
});

describe('financialYearWindow', () => {
  it('spans last FY start → current FY end (AU FY, Jul start)', () => {
    // 31 Jul 2026 → current FY = FY26-27; window 1 Jul 2025 .. 1 Jul 2027.
    const w = financialYearWindow(new Date('2026-07-31T00:00:00Z'));
    expect(w.start.toISOString()).toBe('2025-07-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2027-07-01T00:00:00.000Z');
  });
  it('handles a first-half-of-FY date (Feb 2026 → FY25-26)', () => {
    const w = financialYearWindow(new Date('2026-02-15T00:00:00Z'));
    expect(w.start.toISOString()).toBe('2024-07-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});
