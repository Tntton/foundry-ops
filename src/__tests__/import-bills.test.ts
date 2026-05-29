import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildBillsPreviewWithLookups,
  type BillsLookups,
} from '@/server/imports/bills';

const fixturePath = path.join(__dirname, 'fixtures', 'bills-golden.csv');
const fixture = fs.readFileSync(fixturePath, 'utf8');

function mkLookups(overrides: Partial<BillsLookups> = {}): BillsLookups {
  return {
    supplierByName: new Map([
      ['acme hosting', 'sup-acme'],
      ['globex travel', 'sup-globex'],
    ]),
    projectByCode: new Map([['prj-001', 'pr-001']]),
    personByEmail: new Map([['doug.barnaby@foundry.health', 'p-doug']]),
    existingBills: new Map([['acme hosting|inv-001', 'bill-existing']]),
    ...overrides,
  };
}

describe('bills preview — golden file', () => {
  const result = buildBillsPreviewWithLookups(fixture, 'bills-golden.csv', mkLookups());

  it('parses successfully', () => {
    expect(result.ok).toBe(true);
  });
  if (!result.ok) return;
  const preview = result.preview;

  it('counts 7 total rows', () => {
    expect(preview.totalRows).toBe(7);
  });

  it('flags the existing Acme bill as duplicate (both Acme rows)', () => {
    const acmeRows = preview.rows.filter((r) => r.raw['suppliername'] === 'Acme Hosting');
    expect(acmeRows.length).toBe(2);
    expect(acmeRows.every((r) => r.isDuplicate)).toBe(true);
  });

  it('matches the Globex row to Person + Project', () => {
    const r = preview.rows.find((row) => row.raw['suppliername'] === 'Globex Travel');
    expect(r!.supplierId).toBe('sup-globex');
    expect(r!.projectId).toBe('pr-001');
    expect(r!.attributedPersonId).toBe('p-doug');
    expect(r!.rejectionReason).toBeNull();
  });

  it('rejects the row where GST exceeds total', () => {
    const r = preview.rows.find((row) => row.raw['suppliername'] === 'Bad Supplier');
    expect(r!.rejectionReason).toMatch(/GST/);
  });

  it('rejects the row with an unmatched projectCode', () => {
    const r = preview.rows.find((row) => row.raw['supplierinvoicenumber'] === 'INV-003');
    expect(r!.rejectionReason).toMatch(/projectCode/);
  });

  it('rejects the row with an unmatched attributedPersonEmail', () => {
    const r = preview.rows.find((row) => row.raw['supplierinvoicenumber'] === 'INV-004');
    expect(r!.rejectionReason).toMatch(/attributedPersonEmail/);
  });

  it('rejects the row missing supplierName', () => {
    const r = preview.rows.find((row) => row.raw['supplierinvoicenumber'] === 'INV-005');
    expect(r!.rejectionReason).not.toBeNull();
  });

  it('rolls up per-supplier with match flag', () => {
    const acme = preview.perSupplier.find((s) => s.supplierName === 'Acme Hosting');
    expect(acme!.supplierMatched).toBe(true);
    const mystery = preview.perSupplier.find((s) => s.supplierName === 'Mystery Vendor');
    expect(mystery!.supplierMatched).toBe(false);
  });

  it('rolls up per-project with match flag', () => {
    const ok = preview.perProject.find((p) => p.projectCode === 'PRJ-001');
    expect(ok!.matched).toBe(true);
    const bad = preview.perProject.find((p) => p.projectCode === 'PRJ-999');
    expect(bad!.matched).toBe(false);
  });

  it('totals only accepted rows', () => {
    // accepted: Acme x2 (dupes count as accepted) + Globex = 2*1100 + 3300 = 5500
    // rejected: Bad Supplier (GST), Mystery PRJ-999, Mystery unknown@, blank supplier
    expect(preview.totalAmountDollars).toBeCloseTo(5500, 2);
  });
});

describe('bills preview — empty + missing columns', () => {
  it('errors on empty input', () => {
    const r = buildBillsPreviewWithLookups('', 'empty.csv', mkLookups());
    expect(r.ok).toBe(false);
  });
  it('errors when required columns missing', () => {
    const r = buildBillsPreviewWithLookups('supplierName\nAcme\n', 'missing.csv', mkLookups());
    expect(r.ok).toBe(false);
  });
});
