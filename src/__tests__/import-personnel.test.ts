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

const HEADER =
  'email,firstName,lastName,band,level,employment,region,rateUnit,rateDollars,startDate,phone,whatsappNumber,personalEmail,linkedinUrl,fte,roles,jobTitle';

function build(rows: string[], existing: ExistingPersonRow[] = []) {
  const res = buildPersonnelPreviewWithExisting(
    [HEADER, ...rows].join('\n') + '\n',
    'inline.csv',
    existing,
  );
  if (!res.ok) throw new Error(`parse failed: ${res.error.message}`);
  return res.preview;
}

describe('personnel preview — optional personal email (TASK-304)', () => {
  it('accepts a new contractor with a blank personalEmail', () => {
    const p = build([
      'bob.contractor@foundry.health,Bob,Contractor,Consultant,T2,contractor,AU,hour,200,2025-01-01,,,,,,staff,Consultant',
    ]);
    const row = p.rows[0]!;
    expect(row.action).toBe('new');
    expect(row.errors).toEqual([]);
  });

  it('allows a personalEmail equal to the person’s own work email', () => {
    const p = build([
      'alice.smith@foundry.health,Alice,Smith,Consultant,T2,contractor,AU,hour,200,2025-01-01,,,alice.smith@foundry.health,,,staff,Consultant',
    ]);
    expect(p.rows[0]!.action).toBe('new');
    expect(p.rows[0]!.errors).toEqual([]);
  });

  it('rejects a personalEmail that is a different @foundry.health address', () => {
    const p = build([
      'carol.jones@foundry.health,Carol,Jones,Consultant,T2,contractor,AU,hour,200,2025-01-01,,,someone.else@foundry.health,,,staff,Consultant',
    ]);
    expect(p.rows[0]!.action).toBe('error');
    expect(p.rows[0]!.errors.some((e) => e.includes('foundry.health'))).toBe(true);
  });
});

describe('personnel preview — non-destructive updates (TASK-304)', () => {
  const matt: ExistingPersonRow = {
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
  };

  it('does not diff blank rate / fte / roles cells against the existing record', () => {
    const p = build(
      [
        // rate, fte, roles all blank — everything else matches the existing row.
        'matt.byers@foundry.health,Matt,Byers,Partner,L4,ft,AU,day,,2024-01-15,,,,,,,Partner',
      ],
      [matt],
    );
    const row = p.rows[0]!;
    expect(row.action).toBe('update');
    const fields = row.diff.map((d) => d.field);
    expect(fields).not.toContain('rate (¢)');
    expect(fields).not.toContain('fte');
    expect(fields).not.toContain('roles');
    // With every provided column matching, the diff is empty.
    expect(row.diff).toEqual([]);
  });

  it('still diffs a rate that is actually provided', () => {
    const p = build(
      [
        'matt.byers@foundry.health,Matt,Byers,Partner,L4,ft,AU,day,900,2024-01-15,,,,,,,Partner',
      ],
      [matt],
    );
    const row = p.rows[0]!;
    expect(row.action).toBe('update');
    expect(row.diff.find((d) => d.field === 'rate (¢)')).toBeDefined();
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
