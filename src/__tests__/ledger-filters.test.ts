import { describe, it, expect } from 'vitest';
import {
  parseLedgerFilters,
  ledgerFiltersToQuery,
  parseYmd,
} from '@/server/reports/ledger-filters';

/**
 * TASK-069b · master-ledger filter parsing. Shared by the reporting tab
 * and the export endpoints, so the on-screen view and the download scope
 * identically.
 */

describe('parseYmd', () => {
  it('parses a valid YYYY-MM-DD as a UTC date', () => {
    expect(parseYmd('2026-07-15')?.toISOString()).toBe('2026-07-15T00:00:00.000Z');
  });
  it('rejects malformed input', () => {
    expect(parseYmd('15/07/2026')).toBeUndefined();
    expect(parseYmd(undefined)).toBeUndefined();
    expect(parseYmd('2026-13-40')).toBeUndefined();
  });
});

describe('parseLedgerFilters', () => {
  it('parses direction, type, status', () => {
    const f = parseLedgerFilters({ direction: 'in', sourceType: 'invoice', status: 'sent' });
    expect(f).toMatchObject({ direction: 'in', sourceTypes: ['invoice'], status: 'sent' });
  });
  it('ignores invalid direction / source type', () => {
    const f = parseLedgerFilters({ direction: 'sideways', sourceType: 'nope' });
    expect(f.direction).toBeUndefined();
    expect(f.sourceTypes).toBeUndefined();
  });
  it('makes the `to` bound inclusive of the whole day', () => {
    const f = parseLedgerFilters({ from: '2026-07-01', to: '2026-07-31' });
    expect(f.from?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(f.to?.toISOString()).toBe('2026-07-31T23:59:59.999Z');
  });
  it('passes through project/client ids', () => {
    const f = parseLedgerFilters({ projectId: 'proj_1', clientId: 'cli_1' });
    expect(f).toMatchObject({ projectId: 'proj_1', clientId: 'cli_1' });
  });
  it('takes the first value when a param repeats', () => {
    const f = parseLedgerFilters({ direction: ['out', 'in'] });
    expect(f.direction).toBe('out');
  });
});

describe('ledgerFiltersToQuery', () => {
  it('round-trips the recognised params only', () => {
    const q = ledgerFiltersToQuery({
      direction: 'out',
      status: 'paid',
      junk: 'x',
      from: '2026-07-01',
    });
    expect(q).toContain('direction=out');
    expect(q).toContain('status=paid');
    expect(q).toContain('from=2026-07-01');
    expect(q).not.toContain('junk');
    expect(q.startsWith('?')).toBe(true);
  });
  it('returns empty string when nothing is set', () => {
    expect(ledgerFiltersToQuery({})).toBe('');
  });
});
