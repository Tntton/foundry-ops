import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildWorkbookBuffer,
  sanitiseSheetName,
  resolveReportsRoot,
  type WorkbookSheet,
} from '@/server/exports/excel-workbook';

/**
 * TASK-060 · Excel export infrastructure. Covers the pure workbook
 * builder (round-tripped through SheetJS to prove the bytes are valid
 * .xlsx), sheet-name sanitisation + dedup, and the Reports-root
 * resolution used by the SharePoint publish step.
 */

const ENV_KEYS = ['SHAREPOINT_REPORTS_ROOT', 'SHAREPOINT_ADMIN_ROOT'] as const;
const ORIGINAL: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    ORIGINAL[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
});

function readBack(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return {
    names: wb.SheetNames,
    aoa: (name: string) =>
      XLSX.utils.sheet_to_json(wb.Sheets[name]!, {
        header: 1,
        blankrows: false,
      }) as unknown[][],
  };
}

describe('buildWorkbookBuffer', () => {
  it('produces a valid .xlsx with the header row and numeric cells intact', () => {
    const sheet: WorkbookSheet = {
      name: 'Receivables',
      header: ['Invoice', 'Client', 'Total'],
      rows: [
        ['IFM001-INV-12', 'Acme', 18700],
        ['IFM002-INV-03', 'Globex', 5000],
      ],
    };
    const buf = buildWorkbookBuffer([sheet]);
    expect(Buffer.isBuffer(buf)).toBe(true);

    const back = readBack(buf);
    expect(back.names).toEqual(['Receivables']);
    const rows = back.aoa('Receivables');
    expect(rows[0]).toEqual(['Invoice', 'Client', 'Total']);
    expect(rows[1]).toEqual(['IFM001-INV-12', 'Acme', 18700]);
    // Money stays numeric so Excel can sum the column.
    expect(typeof rows[1]![2]).toBe('number');
  });

  it('writes multiple sheets in order', () => {
    const buf = buildWorkbookBuffer([
      { name: 'All', header: ['a'], rows: [[1]] },
      { name: 'Payables', header: ['b'], rows: [[2]] },
    ]);
    expect(readBack(buf).names).toEqual(['All', 'Payables']);
  });

  it('dedupes colliding sheet names', () => {
    const buf = buildWorkbookBuffer([
      { name: 'Ledger', header: ['a'], rows: [] },
      { name: 'Ledger', header: ['b'], rows: [] },
    ]);
    const names = readBack(buf).names;
    expect(names[0]).toBe('Ledger');
    expect(names[1]).toBe('Ledger (2)');
  });

  it('throws when given no sheets', () => {
    expect(() => buildWorkbookBuffer([])).toThrow(/at least one sheet/u);
  });
});

describe('sanitiseSheetName', () => {
  it('replaces Excel-forbidden characters', () => {
    expect(sanitiseSheetName('AR/AP:2026')).toBe('AR-AP-2026');
    expect(sanitiseSheetName('a[b]c*d?')).toBe('a-b-c-d-');
  });
  it('truncates to 31 characters', () => {
    expect(sanitiseSheetName('X'.repeat(50))).toHaveLength(31);
  });
  it('falls back to "Sheet" when empty', () => {
    expect(sanitiseSheetName('   ')).toBe('Sheet');
  });
});

describe('resolveReportsRoot', () => {
  it('defaults to the Financial reports tree', () => {
    expect(resolveReportsRoot()).toBe(
      'CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/04 Reports',
    );
  });
  it('nests under SHAREPOINT_ADMIN_ROOT when set', () => {
    process.env['SHAREPOINT_ADMIN_ROOT'] = 'CORP/ADMIN';
    expect(resolveReportsRoot()).toBe('CORP/ADMIN/04 Reports');
  });
  it('honours an explicit SHAREPOINT_REPORTS_ROOT', () => {
    process.env['SHAREPOINT_REPORTS_ROOT'] = 'CUSTOM/Reports';
    process.env['SHAREPOINT_ADMIN_ROOT'] = 'CORP/ADMIN';
    expect(resolveReportsRoot()).toBe('CUSTOM/Reports');
  });
});
