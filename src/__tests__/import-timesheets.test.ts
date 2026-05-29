import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildTimesheetPreviewWithLookups,
  type TimesheetLookups,
} from '@/server/imports/timesheets';

const fixturePath = path.join(__dirname, 'fixtures', 'timesheets-golden.csv');
const fixture = fs.readFileSync(fixturePath, 'utf8');

function mkLookups(overrides: Partial<TimesheetLookups> = {}): TimesheetLookups {
  return {
    personByEmail: new Map([
      ['matt.byers@foundry.health', 'p-matt'],
      ['suze.legrand@foundry.health', 'p-suze'],
    ]),
    projectByCode: new Map([['prj-001', 'pr-001']]),
    existingDuplicates: new Map([['p-matt|pr-001|2025-07-15', 'ts-existing']]),
    ...overrides,
  };
}

describe('timesheet preview — golden file', () => {
  const result = buildTimesheetPreviewWithLookups(
    fixture,
    'timesheets-golden.csv',
    mkLookups(),
  );

  it('parses the file successfully', () => {
    expect(result.ok).toBe(true);
  });

  if (!result.ok) return;
  const preview = result.preview;

  it('counts 9 total rows', () => {
    expect(preview.totalRows).toBe(9);
  });

  it('accepts the rows with matching person + project + date', () => {
    // Rows 1, 2, 3 are valid; row 7 is also valid (and duplicate).
    expect(preview.acceptedCount).toBeGreaterThanOrEqual(4);
  });

  it('flags the duplicate row against the existing entry', () => {
    expect(preview.duplicateCount).toBeGreaterThanOrEqual(1);
    const dups = preview.rows.filter((r) => r.isDuplicate);
    expect(dups.length).toBeGreaterThanOrEqual(1);
    expect(dups[0]!.existingEntryId).toBe('ts-existing');
  });

  it('rejects the unknown-person row', () => {
    const r = preview.rows.find((row) => row.raw['personemail'] === 'unknown@foundry.health');
    expect(r!.rejectionReason).toMatch(/no Person/);
  });

  it('rejects the bad-project row', () => {
    const r = preview.rows.find((row) => row.raw['projectcode'] === 'PRJ-999');
    expect(r!.rejectionReason).toMatch(/no Project/);
  });

  it('rejects the date-too-old row', () => {
    const r = preview.rows.find((row) => row.raw['date'] === '2018-01-01');
    expect(r!.rejectionReason).toMatch(/3 fiscal years/);
  });

  it('rejects the malformed-date row', () => {
    const r = preview.rows.find((row) => row.raw['date'] === 'not-a-date');
    expect(r!.rejectionReason).not.toBeNull();
  });

  it('rejects the hours-over-cap row', () => {
    const r = preview.rows.find((row) => row.raw['hours'] === '30');
    expect(r!.rejectionReason).not.toBeNull();
  });

  it('produces a per-person summary with matched flag', () => {
    const matt = preview.perPerson.find((p) => p.personEmail === 'matt.byers@foundry.health');
    expect(matt!.matched).toBe(true);
    const unknown = preview.perPerson.find((p) => p.personEmail === 'unknown@foundry.health');
    expect(unknown!.matched).toBe(false);
  });

  it('produces a per-project summary with matched flag', () => {
    const ok = preview.perProject.find((p) => p.projectCode === 'PRJ-001');
    expect(ok!.matched).toBe(true);
    const bad = preview.perProject.find((p) => p.projectCode === 'PRJ-999');
    expect(bad!.matched).toBe(false);
  });

  it('sums total hours over the accepted rows only', () => {
    // accepted rows: matt 7.5, matt 4, suze 8, matt 3 (duplicate counts as accepted)
    // = 22.5
    expect(preview.totalHours).toBeCloseTo(22.5, 2);
  });

  it('counts rejected = totalRows - acceptedCount', () => {
    expect(preview.rejectedCount + preview.acceptedCount).toBe(preview.totalRows);
  });
});

describe('timesheet preview — empty + missing columns', () => {
  it('errors on empty input', () => {
    const result = buildTimesheetPreviewWithLookups('', 'empty.csv', mkLookups());
    expect(result.ok).toBe(false);
  });

  it('errors when required columns missing', () => {
    const result = buildTimesheetPreviewWithLookups(
      'personEmail\na@b.com\n',
      'missing.csv',
      mkLookups(),
    );
    expect(result.ok).toBe(false);
  });
});
