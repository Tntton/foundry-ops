import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildExpensesPreviewWithLookups,
  type ExpensesLookups,
} from '@/server/imports/expenses';

const fixturePath = path.join(__dirname, 'fixtures', 'expenses-golden.csv');
const fixture = fs.readFileSync(fixturePath, 'utf8');

function mkLookups(overrides: Partial<ExpensesLookups> = {}): ExpensesLookups {
  return {
    personByEmail: new Map([
      ['doug.barnaby@foundry.health', 'p-doug'],
      ['matt.byers@foundry.health', 'p-matt'],
    ]),
    projectByCode: new Map([['prj-001', 'pr-001']]),
    ...overrides,
  };
}

describe('expenses preview — golden file', () => {
  const result = buildExpensesPreviewWithLookups(
    fixture,
    'expenses-golden.csv',
    mkLookups(),
  );
  it('parses successfully', () => {
    expect(result.ok).toBe(true);
  });
  if (!result.ok) return;
  const preview = result.preview;

  it('counts 8 total rows', () => {
    expect(preview.totalRows).toBe(8);
  });

  it('accepts the rows with matching person + project + ok date + clean GST', () => {
    // 3 accepted: Doug PRJ-001 x2, Matt OPEX
    expect(preview.acceptedCount).toBe(3);
  });

  it('matches Doug + Matt; rejects unknown@', () => {
    const unknown = preview.rows.find((r) => r.raw['personemail'] === 'unknown@foundry.health');
    expect(unknown!.rejectionReason).toMatch(/no Person/);
  });

  it('rejects bad-GST row', () => {
    const r = preview.rows.find((row) => row.raw['gstdollars'] === '200.00');
    expect(r!.rejectionReason).toMatch(/GST/);
  });

  it('rejects too-old row', () => {
    const r = preview.rows.find((row) => row.raw['date'] === '2018-01-01');
    expect(r!.rejectionReason).toMatch(/3 fiscal years/);
  });

  it('rejects bad-project row', () => {
    const r = preview.rows.find((row) => row.raw['projectcode'] === 'PRJ-999');
    expect(r!.rejectionReason).toMatch(/projectCode/);
  });

  it('rejects bad-date row', () => {
    const r = preview.rows.find((row) => row.raw['date'] === 'not-a-date');
    expect(r!.rejectionReason).not.toBeNull();
  });

  it('per-person summary marks matched / unmatched', () => {
    const doug = preview.perPerson.find((p) => p.personEmail === 'doug.barnaby@foundry.health');
    expect(doug!.matched).toBe(true);
    const unknown = preview.perPerson.find((p) => p.personEmail === 'unknown@foundry.health');
    expect(unknown!.matched).toBe(false);
  });

  it('totals only accepted rows', () => {
    // Doug PRJ-001: 44 + 165, Matt OPEX: 22 → 231
    expect(preview.totalAmountDollars).toBeCloseTo(231, 2);
  });
});

describe('expenses preview — empty + missing columns', () => {
  it('errors on empty input', () => {
    const r = buildExpensesPreviewWithLookups('', 'empty.csv', mkLookups());
    expect(r.ok).toBe(false);
  });
  it('errors when required columns missing', () => {
    const r = buildExpensesPreviewWithLookups(
      'personEmail\na@b.com\n',
      'missing.csv',
      mkLookups(),
    );
    expect(r.ok).toBe(false);
  });
});
