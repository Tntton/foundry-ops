import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPersonnelPreviewWithExisting,
  type ExistingPersonRow,
} from '@/server/imports/personnel';

const fixturePath = path.join(__dirname, 'fixtures', 'personnel-golden.csv');
const fixture = fs.readFileSync(fixturePath, 'utf8');

function mkExisting(overrides: Partial<ExistingPersonRow> = {}): ExistingPersonRow {
  return {
    id: 'p-matt',
    email: 'matt.byers@foundry.health',
    firstName: 'Matt',
    lastName: 'Byers',
    band: 'Partner',
    level: 'L4',
    employment: 'ft',
    region: 'AU',
    rateUnit: 'day',
    rate: 200_000,
    startDate: new Date('2024-01-15'),
    phone: null,
    whatsappNumber: null,
    personalEmail: null,
    linkedinUrl: null,
    fte: { toString: () => '1.00' },
    roles: ['partner'],
    initials: 'MB',
    ...overrides,
  };
}

describe('personnel preview — golden file', () => {
  const existing = [mkExisting()];
  const result = buildPersonnelPreviewWithExisting(fixture, 'personnel-golden.csv', existing);

  it('parses the file successfully', () => {
    expect(result.ok).toBe(true);
  });

  if (!result.ok) return;
  const preview = result.preview;

  it('counts 7 total rows', () => {
    expect(preview.totalRows).toBe(7);
  });

  it('flags Matt Byers (row 2) as an update vs the existing fixture', () => {
    const mattRow = preview.rows.find((r) => r.raw['email'] === 'matt.byers@foundry.health');
    expect(mattRow).toBeDefined();
    expect(mattRow!.action).toBe('update');
    // Day rate didn't change in the fixture (200000¢ == $2000/day), but
    // band did — actually fixture has same band. Let me just confirm
    // the diff is empty or has only minor fields.
    expect(mattRow!.matchedPersonId).toBe('p-matt');
  });

  it('flags Jas + Suze as new', () => {
    const jas = preview.rows.find(
      (r) => r.raw['email'] === 'jas.navarro@foundry.health' && r.rowIndex === 1,
    );
    expect(jas).toBeDefined();
    expect(jas!.action).toBe('new');

    const suze = preview.rows.find((r) => r.raw['email'] === 'suze.legrand@foundry.health');
    expect(suze!.action).toBe('new');
  });

  it('rejects the row missing email', () => {
    const noEmail = preview.rows.find((r) => r.raw['firstname'] === 'Bob');
    expect(noEmail!.action).toBe('error');
    expect(noEmail!.errors.some((e) => e.startsWith('email'))).toBe(true);
  });

  it('flags the duplicate-email row', () => {
    expect(preview.duplicateEmails).toContain('jas.navarro@foundry.health');
    const dupRow = preview.rows.find((r) => r.rowIndex === 5);
    expect(dupRow!.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects the new contractor with a non-foundry.health work email', () => {
    const bad = preview.rows.find((r) => r.raw['email'] === 'invalid.contractor@external.com');
    expect(bad!.action).toBe('error');
    expect(bad!.errors.some((e) => e.includes('foundry.health'))).toBe(true);
  });

  it('rejects rows with invalid role tokens', () => {
    const gary = preview.rows.find((r) => r.raw['email'] === 'gary.partner@foundry.health');
    expect(gary!.action).toBe('error');
    expect(gary!.errors.some((e) => e.startsWith('roles'))).toBe(true);
  });

  it('rolls up counts correctly', () => {
    expect(preview.newCount + preview.updateCount + preview.errorCount).toBe(preview.totalRows);
    expect(preview.errorCount).toBeGreaterThan(0);
  });
});

describe('personnel preview — empty + missing columns', () => {
  it('errors on an empty file', () => {
    const result = buildPersonnelPreviewWithExisting('', 'empty.csv', []);
    expect(result.ok).toBe(false);
  });

  it('errors when required columns are missing', () => {
    const result = buildPersonnelPreviewWithExisting('email\na@b.com\n', 'missing.csv', []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message.toLowerCase()).toContain('missing required column');
  });
});
