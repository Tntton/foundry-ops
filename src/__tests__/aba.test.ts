import { describe, it, expect } from 'vitest';
import {
  buildAbaFile,
  buildDetail,
  buildHeader,
  buildTrailer,
  type AbaHeader,
} from '@/server/integrations/aba';

const LINE_LENGTH = 120;

const baseHeader: AbaHeader = {
  bsb: '062-001',
  account: '12345678',
  userIdentificationNumber: '301500',
  userName: 'FOUNDRY HEALTH PTY LTD',
  bankAbbreviation: 'CBA',
  processingDateDdMmYy: '150525',
  description: 'PAY RUN',
};

describe('buildHeader', () => {
  it('produces a 120-char descriptor line starting with 0', () => {
    const line = buildHeader(baseHeader);
    expect(line.length).toBe(LINE_LENGTH);
    expect(line.charAt(0)).toBe('0');
  });

  it('upper-cases user name + description', () => {
    const line = buildHeader({ ...baseHeader, userName: 'foundry health', description: 'monthly' });
    expect(line).toContain('FOUNDRY HEALTH');
    expect(line).toContain('MONTHLY');
  });

  it('truncates long user names to 26 chars', () => {
    const line = buildHeader({
      ...baseHeader,
      userName: 'FOUNDRY HEALTH AND WELLBEING PTY LIMITED AU',
    });
    expect(line.length).toBe(LINE_LENGTH);
    // Name starts after 1 + 17 + 2 + 3 + 7 = 30 chars; occupies next 26
    expect(line.slice(30, 56)).toBe('FOUNDRY HEALTH AND WELLBEI');
  });

  it('rejects invalid processing date format', () => {
    expect(() =>
      buildHeader({ ...baseHeader, processingDateDdMmYy: '2025-05-15' }),
    ).toThrow(/Invalid processing date/);
  });
});

describe('buildDetail', () => {
  it('produces a 120-char detail line starting with 1', () => {
    const line = buildDetail({
      bsb: '062-001',
      account: '11111111',
      amountCents: 123456,
      reference: 'INVIFM001INV01',
      payeeName: 'ACME HEALTH PTY LTD',
      remitterName: 'FOUNDRY HEALTH',
    });
    expect(line.length).toBe(LINE_LENGTH);
    expect(line.charAt(0)).toBe('1');
    expect(line).toContain('062-001');
  });

  it('normalises BSBs with and without dashes', () => {
    const a = buildDetail({
      bsb: '062001',
      account: '1234567',
      amountCents: 100,
      reference: 'X',
      payeeName: 'X',
      remitterName: 'X',
    });
    const b = buildDetail({
      bsb: '062-001',
      account: '1234567',
      amountCents: 100,
      reference: 'X',
      payeeName: 'X',
      remitterName: 'X',
    });
    expect(a).toBe(b);
  });

  it('rejects invalid BSBs', () => {
    expect(() =>
      buildDetail({
        bsb: '12345',
        account: '12345678',
        amountCents: 1,
        reference: 'X',
        payeeName: 'X',
        remitterName: 'X',
      }),
    ).toThrow(/Invalid BSB/);
  });

  it('right-pads account to 9 digits, amount to 10', () => {
    const line = buildDetail({
      bsb: '062-001',
      account: '123',
      amountCents: 5,
      reference: 'REF',
      payeeName: 'PAYEE',
      remitterName: 'REM',
    });
    // record type (1) + BSB (7) = 8, then account starts
    expect(line.slice(8, 17)).toBe('000000123');
    // withholding indicator 1 + tx code 2 = 3 chars after account → amount at 20
    expect(line.slice(20, 30)).toBe('0000000005');
  });
});

describe('buildTrailer', () => {
  it('sums amounts and counts detail records', () => {
    const line = buildTrailer(1234567, 42);
    expect(line.length).toBe(LINE_LENGTH);
    expect(line.charAt(0)).toBe('7');
    expect(line).toContain('999-999');
    // net total + credit total + debit total = 30 cols of zeros + amounts
    expect(line.slice(20, 30)).toBe('0001234567');
    expect(line.slice(30, 40)).toBe('0001234567');
    // Number of detail records padded to 6 after 64 spaces of filler
    expect(line.slice(74, 80)).toBe('000042');
  });
});

describe('buildAbaFile', () => {
  it('assembles header + details + trailer with CRLF separators', () => {
    const file = buildAbaFile(baseHeader, [
      {
        bsb: '062-001',
        account: '11111111',
        amountCents: 100000, // $1000
        reference: 'IFM001-INV-01',
        payeeName: 'ACME HEALTH',
        remitterName: 'FOUNDRY HEALTH',
      },
      {
        bsb: '083-123',
        account: '222',
        amountCents: 50000, // $500
        reference: 'IFM002-INV-01',
        payeeName: 'BETA WORLD',
        remitterName: 'FOUNDRY HEALTH',
      },
    ]);
    const lines = file.split(/\r\n/).filter(Boolean);
    expect(lines).toHaveLength(4); // 1 header + 2 details + 1 trailer
    for (const l of lines) expect(l.length).toBe(LINE_LENGTH);
    // Trailer total = 1500.00 = 150000 cents
    expect(lines[3]).toContain('0000150000');
  });

  it('refuses to build an empty file', () => {
    expect(() => buildAbaFile(baseHeader, [])).toThrow(/empty ABA file/);
  });
});
