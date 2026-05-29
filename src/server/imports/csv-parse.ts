import Papa from 'papaparse';

export const MAX_IMPORT_ROWS = 5000;

export type ParsedCsv = {
  /** Normalised header names — lowercased, trimmed, in original column order. */
  headers: string[];
  /** Header → row-value record, one per data row. Keys are normalised. */
  rows: Array<Record<string, string>>;
};

export type CsvParseError = {
  message: string;
};

export type CsvParseResult =
  | { ok: true; data: ParsedCsv }
  | { ok: false; error: CsvParseError };

/**
 * Parse a CSV string into normalised header/row records.
 *
 *  - Headers are lowercased + trimmed so callers can look up columns
 *    case-insensitively and never rely on column order.
 *  - Empty rows (every cell blank) are dropped.
 *  - Rows are capped at MAX_IMPORT_ROWS to keep the dry-run cache + the
 *    commit transaction reasonable. Jas's historical FY26 timesheet upload
 *    is the heaviest target — ~hundreds of rows; 5000 leaves plenty of
 *    headroom while making genuine accidents (the whole audit log) fail
 *    fast.
 */
export function parseCsv(input: string): CsvParseResult {
  const trimmed = input.replace(/^﻿/, '');
  const out = Papa.parse<string[]>(trimmed, {
    skipEmptyLines: 'greedy',
    transform: (v: string) => v,
  });
  // Papa emits a benign "auto-detect delimiter" notice on single-column
  // inputs; ignore that one but propagate genuine parse failures.
  const fatal = out.errors.find((e) => e.type === 'Delimiter' && /unable to auto-detect/i.test(e.message))
    ? out.errors.filter((e) => !(e.type === 'Delimiter'))
    : out.errors;
  if (fatal.length > 0) {
    return { ok: false, error: { message: `CSV parse error: ${fatal[0]!.message}` } };
  }
  const raw = (out.data ?? []) as string[][];
  if (raw.length === 0) {
    return { ok: false, error: { message: 'CSV is empty.' } };
  }
  const headerRow = raw[0]!.map((h) => h.trim().toLowerCase());
  const dataRows = raw.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: {
        message: `Too many rows (${dataRows.length}). Split the file — limit is ${MAX_IMPORT_ROWS} rows per upload.`,
      },
    };
  }
  if (headerRow.length === 0 || headerRow.every((h) => h === '')) {
    return { ok: false, error: { message: 'CSV header row is empty.' } };
  }

  const rows: Array<Record<string, string>> = [];
  for (const row of dataRows) {
    const rec: Record<string, string> = {};
    for (let i = 0; i < headerRow.length; i++) {
      const key = headerRow[i] ?? '';
      if (!key) continue;
      const cell = row[i] ?? '';
      rec[key] = typeof cell === 'string' ? cell.trim() : String(cell ?? '').trim();
    }
    rows.push(rec);
  }
  return { ok: true, data: { headers: headerRow, rows } };
}

export function requireHeaders(parsed: ParsedCsv, required: readonly string[]): string[] {
  const present = new Set(parsed.headers);
  const missing: string[] = [];
  for (const h of required) {
    if (!present.has(h.toLowerCase())) missing.push(h);
  }
  return missing;
}
