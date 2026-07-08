import { describe, it, expect } from 'vitest';
import {
  detectBulkKind,
  extractHeaderCells,
} from '@/server/agents/assistant/bulk-csv';

describe('extractHeaderCells', () => {
  it('lowercases + trims cells from the first non-empty line', () => {
    expect(extractHeaderCells('PersonEmail, ProjectCode, Date, Hours\nrow\n')).toEqual([
      'personemail',
      'projectcode',
      'date',
      'hours',
    ]);
  });
  it('skips blank leading lines', () => {
    expect(extractHeaderCells('\n\nfoo,bar\n')).toEqual(['foo', 'bar']);
  });
  it('strips surrounding double-quotes on cells', () => {
    expect(extractHeaderCells('"personEmail","hours"')).toEqual([
      'personemail',
      'hours',
    ]);
  });
  it('returns [] for empty input', () => {
    expect(extractHeaderCells('')).toEqual([]);
  });
});

describe('detectBulkKind', () => {
  it('detects timesheets from the canonical template header', () => {
    const headers = extractHeaderCells(
      'personEmail,projectCode,date,hours,notes',
    );
    expect(detectBulkKind(headers)).toBe('timesheets');
  });

  it('detects personnel from the canonical template header', () => {
    const headers = extractHeaderCells(
      'email,firstName,lastName,band,level,employment,region,rateUnit,rateDollars,startDate',
    );
    expect(detectBulkKind(headers)).toBe('personnel');
  });

  it('detects bills from the canonical template header', () => {
    const headers = extractHeaderCells(
      'supplierName,supplierInvoiceNumber,issueDate,dueDate,amountTotalDollars,gstDollars,category,projectCode',
    );
    expect(detectBulkKind(headers)).toBe('bills');
  });

  it('detects expenses from the canonical template header', () => {
    const headers = extractHeaderCells(
      'personEmail,date,amountTotalDollars,gstDollars,category,description,projectCode',
    );
    expect(detectBulkKind(headers)).toBe('expenses');
  });

  it('returns null for a CSV with unrelated headers', () => {
    const headers = extractHeaderCells('foo,bar,baz');
    expect(detectBulkKind(headers)).toBeNull();
  });

  it('returns null when only ~half the required columns are present', () => {
    // 2 of 4 required timesheet headers (personEmail + date) — below 0.75 threshold.
    const headers = extractHeaderCells('personEmail,date,note');
    expect(detectBulkKind(headers)).toBeNull();
  });

  it('is case-insensitive on the header column names', () => {
    const headers = extractHeaderCells(
      'PERSONEMAIL,ProjectCode,DATE,HOURS',
    );
    expect(detectBulkKind(headers)).toBe('timesheets');
  });

  it('tolerates extra columns beyond the required set', () => {
    const headers = extractHeaderCells(
      'personEmail,projectCode,date,hours,notes,extraColumn,another',
    );
    expect(detectBulkKind(headers)).toBe('timesheets');
  });

  it('distinguishes expenses from timesheets when both share personEmail', () => {
    // Expenses has personEmail + date + amountTotalDollars + gstDollars +
    // category. Timesheets needs hours. Without hours, must land on expenses.
    const headers = extractHeaderCells(
      'personEmail,date,amountTotalDollars,gstDollars,category',
    );
    expect(detectBulkKind(headers)).toBe('expenses');
  });
});
