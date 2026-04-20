import { describe, it, expect } from 'vitest';
import { parseXeroDate, signedAmountCents } from '@/server/integrations/xero-bankfeed';

describe('parseXeroDate', () => {
  it('parses ms-epoch /Date()/ with offset', () => {
    const d = parseXeroDate('/Date(1775347200000+0000)/');
    expect(d.toISOString()).toBe('2026-04-05T00:00:00.000Z');
  });

  it('parses /Date()/ without offset (offset segment is cosmetic)', () => {
    const d = parseXeroDate('/Date(1775347200000)/');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(3); // April
    expect(d.getUTCDate()).toBe(5);
  });

  it('throws on malformed input', () => {
    expect(() => parseXeroDate('not-a-date')).toThrow(/Invalid Xero date/);
  });
});

describe('signedAmountCents', () => {
  it('SPEND transactions become negative (money out)', () => {
    expect(signedAmountCents('SPEND', 220)).toBe(-22_000);
    expect(signedAmountCents('SPEND-TRANSFER', 1000)).toBe(-100_000);
  });

  it('RECEIVE transactions stay positive (money in)', () => {
    expect(signedAmountCents('RECEIVE', 15_000)).toBe(1_500_000);
    expect(signedAmountCents('RECEIVE-TRANSFER', 500)).toBe(50_000);
  });

  it('rounds cents correctly on fractional decimals', () => {
    expect(signedAmountCents('RECEIVE', 12.345)).toBe(1235); // banker's rounding not required
    expect(signedAmountCents('SPEND', 0.01)).toBe(-1);
  });
});
