/**
 * Minimal CSV writer. RFC 4180-ish: quote fields that contain commas, quotes,
 * or newlines; escape embedded double-quotes by doubling. No external dep.
 */
export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  const lines = [header.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  return lines.join('\r\n') + '\r\n';
}

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : v;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Format AUD cents as a plain decimal string (no currency symbol or
 * separators) for Excel-friendly CSV output.
 */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
