import { prisma } from '@/server/db';
import {
  buildWorkbookBuffer,
  type WorkbookSheet,
} from '@/server/exports/excel-workbook';
import {
  computeFirmUtilisation,
  currentMonthYm,
  type FirmUtilisation,
} from '@/server/reports/utilisation';

/**
 * Timesheet.xlsx (TASK-062) — by person, by project, utilisation.
 * Covers the current + last financial year of approved/billed hours.
 * The grouping (`timesheetSheets`) is pure and exported for tests; the
 * utilisation sheet reuses `computeFirmUtilisation`.
 */

const d = (cents: number): number => cents / 100;

export type TimesheetExportEntry = {
  personId: string;
  personName: string;
  personInitials: string;
  projectCode: string;
  projectName: string;
  hours: number;
  costCents: number;
  billed: boolean;
};

/**
 * Australian FY window covering the current + previous FY: from 1 Jul of
 * last FY's start year to 1 Jul following the current FY (exclusive).
 * Exported for tests. AU FY starts 1 Jul.
 */
export function financialYearWindow(now: Date): { start: Date; end: Date } {
  const y = now.getUTCFullYear();
  const currentFyStartYear = now.getUTCMonth() >= 6 ? y : y - 1; // Jul = month 6
  const start = new Date(Date.UTC(currentFyStartYear - 1, 6, 1)); // last FY start
  const end = new Date(Date.UTC(currentFyStartYear + 1, 6, 1)); // exclusive
  return { start, end };
}

function byPersonSheet(entries: TimesheetExportEntry[]): WorkbookSheet {
  const map = new Map<
    string,
    { name: string; initials: string; hours: number; cost: number; billedHours: number }
  >();
  for (const e of entries) {
    const row =
      map.get(e.personId) ??
      { name: e.personName, initials: e.personInitials, hours: 0, cost: 0, billedHours: 0 };
    row.hours += e.hours;
    row.cost += e.costCents;
    if (e.billed) row.billedHours += e.hours;
    map.set(e.personId, row);
  }
  const rows = [...map.values()]
    .sort((a, b) => b.hours - a.hours)
    .map((r) => [
      r.name,
      r.initials,
      Number(r.hours.toFixed(2)),
      d(r.cost),
      Number(r.billedHours.toFixed(2)),
    ]);
  return {
    name: 'By person',
    header: ['Person', 'Initials', 'Hours', 'Cost (AUD)', 'Billed hours'],
    rows,
  };
}

function byProjectSheet(entries: TimesheetExportEntry[]): WorkbookSheet {
  const map = new Map<string, { code: string; name: string; hours: number; cost: number }>();
  for (const e of entries) {
    const row = map.get(e.projectCode) ?? { code: e.projectCode, name: e.projectName, hours: 0, cost: 0 };
    row.hours += e.hours;
    row.cost += e.costCents;
    map.set(e.projectCode, row);
  }
  const rows = [...map.values()]
    .sort((a, b) => b.hours - a.hours)
    .map((r) => [r.code, r.name, Number(r.hours.toFixed(2)), d(r.cost)]);
  return {
    name: 'By project',
    header: ['Project', 'Name', 'Hours', 'Cost (AUD)'],
    rows,
  };
}

function utilisationSheet(util: FirmUtilisation): WorkbookSheet {
  return {
    name: 'Utilisation',
    header: [
      'Person',
      'Band',
      'Level',
      'FTE',
      'Target hours',
      'Logged hours',
      'Billed hours',
      'Utilisation %',
    ],
    rows: util.rows.map((r) => [
      `${r.firstName} ${r.lastName}`,
      r.band,
      r.level,
      r.fte,
      r.targetHours,
      r.loggedHours,
      r.billedHours,
      r.utilisationPct ?? '',
    ]),
  };
}

/** Pure — assemble the three Timesheet sheets. */
export function timesheetSheets(
  entries: TimesheetExportEntry[],
  util: FirmUtilisation,
): WorkbookSheet[] {
  return [byPersonSheet(entries), byProjectSheet(entries), utilisationSheet(util)];
}

export async function buildTimesheetWorkbook(): Promise<Buffer> {
  const { start, end } = financialYearWindow(new Date());
  const [rows, util] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { date: { gte: start, lt: end }, status: { in: ['approved', 'billed'] } },
      select: {
        hours: true,
        billedInvoiceId: true,
        person: {
          select: { id: true, firstName: true, lastName: true, initials: true, rate: true },
        },
        project: { select: { code: true, name: true } },
      },
    }),
    computeFirmUtilisation(currentMonthYm()),
  ]);

  const entries: TimesheetExportEntry[] = rows.map((e) => ({
    personId: e.person.id,
    personName: `${e.person.firstName} ${e.person.lastName}`,
    personInitials: e.person.initials,
    projectCode: e.project.code,
    projectName: e.project.name,
    hours: Number(e.hours),
    costCents: Math.round(Number(e.hours) * (e.person.rate ?? 0)),
    billed: e.billedInvoiceId != null,
  }));

  return buildWorkbookBuffer(timesheetSheets(entries, util));
}
