/**
 * Format money from integer cents (AUD) to a human-readable string.
 * Null/0 displays as em-dash.
 */
export function formatRateCents(cents: number, unit: 'hour' | 'day'): string {
  if (cents === 0) return '—';
  const dollars = cents / 100;
  const formatted = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(dollars);
  return `${formatted}/${unit === 'hour' ? 'h' : 'd'}`;
}

export function formatFte(fte: number): string {
  if (fte === 1) return 'FT';
  return fte.toFixed(2);
}

/**
 * Format an absolute timestamp in the user's local timezone (Foundry is
 * AU-based, so we pin to Australia/Sydney). The server runs in UTC, so
 * `Date.toLocaleString()` without `timeZone` shows GMT to every staffer
 * regardless of where they're sitting.
 *
 * Pass `Intl.DateTimeFormatOptions` to override format (e.g. `hour12: false`
 * for 24-hour audit-style display, or a custom field set for compact
 * snapshots).
 */
export function formatLocalDateTime(
  d: Date,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return d.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    ...opts,
  });
}
