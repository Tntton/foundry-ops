import { describe, it, expect } from 'vitest';
import { centsToDecimal, toCsv } from '@/server/reports/csv';

describe('toCsv', () => {
  it('joins rows with CRLF and ends with trailing newline', () => {
    const out = toCsv(['a', 'b'], [
      [1, 2],
      [3, 4],
    ]);
    expect(out).toBe('a,b\r\n1,2\r\n3,4\r\n');
  });

  it('quotes cells containing commas, quotes, and newlines', () => {
    const out = toCsv(['x'], [
      ['no special'],
      ['has, comma'],
      ['has "quotes"'],
      ['has\nnewline'],
    ]);
    expect(out).toContain('no special');
    expect(out).toContain('"has, comma"');
    expect(out).toContain('"has ""quotes"""');
    expect(out).toContain('"has\nnewline"');
  });

  it('handles null / undefined as empty cells', () => {
    const out = toCsv(['a', 'b', 'c'], [[null, undefined, 0]]);
    expect(out).toBe('a,b,c\r\n,,0\r\n');
  });
});

describe('centsToDecimal', () => {
  it('formats plain cents', () => {
    expect(centsToDecimal(0)).toBe('0.00');
    expect(centsToDecimal(1)).toBe('0.01');
    expect(centsToDecimal(100)).toBe('1.00');
    expect(centsToDecimal(1234)).toBe('12.34');
  });

  it('handles negative and large values', () => {
    expect(centsToDecimal(-5000)).toBe('-50.00');
    expect(centsToDecimal(1_500_000)).toBe('15000.00');
  });
});
