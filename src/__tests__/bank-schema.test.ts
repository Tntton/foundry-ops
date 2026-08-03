import { describe, it, expect } from 'vitest';
import { BankSchema } from '@/app/(app)/me/bank-schema';

/**
 * Regression coverage for the "IBAN for NZ bank account numbers" ticket:
 * a New Zealand staff member (BNZ) has no BSB and no IBAN, only a local
 * account number, and the form used to reject them because non-AU
 * countries were forced to supply SWIFT or IBAN.
 */
// Mirror how the server action feeds the schema: every rendered input
// yields '' when left blank (the schema maps '' → null), never
// `undefined`. Tests override only the fields they care about.
function parse(input: Record<string, unknown>) {
  return BankSchema.safeParse({
    bankAccountName: '',
    bankName: '',
    bankBsb: '',
    bankAcc: '',
    bankSwift: '',
    bankIban: '',
    ...input,
  });
}

describe('BankSchema', () => {
  it('accepts an NZ account via the local account-number field alone', () => {
    const r = parse({
      bankCountry: 'NZ',
      bankAccountName: 'Shea Laws',
      bankName: 'BNZ',
      bankAcc: '02-1234-0123456-000',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a non-AU account with no routing detail at all', () => {
    const r = parse({
      bankCountry: 'NZ',
      bankAccountName: 'Shea Laws',
      bankName: 'BNZ',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toContain('bankCountry');
    }
  });

  it('still accepts a non-AU account via SWIFT or IBAN', () => {
    expect(parse({ bankCountry: 'GB', bankIban: 'GB29 NWBK 6016 1331 9268 19' }).success).toBe(true);
    expect(parse({ bankCountry: 'US', bankSwift: 'CHASUS33' }).success).toBe(true);
  });

  it('still requires BSB + Acc for AU', () => {
    expect(parse({ bankCountry: 'AU', bankBsb: '062-000' }).success).toBe(false);
    expect(parse({ bankCountry: 'AU', bankBsb: '062000', bankAcc: '12345678' }).success).toBe(true);
  });

  it('accepts a completely empty form (partial save)', () => {
    expect(parse({ bankCountry: 'NZ' }).success).toBe(true);
  });

  it('rejects a malformed IBAN when one is supplied', () => {
    const r = parse({ bankCountry: 'FR', bankIban: 'not-an-iban!!' });
    expect(r.success).toBe(false);
  });
});
