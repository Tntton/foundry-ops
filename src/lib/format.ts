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
