import { z } from 'zod';

// ─── Bank account ──────────────────────────────────────────────────────
//
// International-friendly. The `bankCountry` ISO code selects which
// fields are required: AU asks for BSB+Acc, everything else accepts a
// SWIFT/BIC, an IBAN, OR a local account number. Not every country uses
// IBAN — NZ (e.g. BNZ) uses a bank-branch-account-suffix number with no
// IBAN at all.
//
// Extracted from actions.ts (a `'use server'` module, which may only
// export async server actions) so the validation can be unit-tested.
//
// Empty handling: FormData yields '' for a rendered-but-blank input and
// null for an absent one — both mean "no value". Every optional field is
// normalised blank → null BEFORE format validation, so a blank IBAN/SWIFT
// field doesn't trip its own format check. (The previous schema validated
// '' against the IBAN pattern and rejected it — which is what locked NZ
// staff out with a spurious "IBAN format invalid".)

/** Trimmed string, or null when the value is absent/blank. */
function blankToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Optional free-text field: blank → null, else trimmed + length-capped. */
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().max(max).nullable());

/** Optional field with a format check that only runs on a real value.
 *  `normalise` runs after blank→null (skipped when null). */
const optionalFormatted = (
  normalise: (s: string) => string,
  pattern: RegExp,
  message: string,
) =>
  z.preprocess((v) => {
    const s = blankToNull(v);
    return s === null ? null : normalise(s);
  }, z.string().regex(pattern, message).nullable());

export const BankSchema = z
  .object({
    bankCountry: z.preprocess(
      (v) =>
        typeof v === 'string' && v.trim() !== ''
          ? v.trim().toUpperCase()
          : 'AU',
      z.string().max(2),
    ),
    bankAccountName: optionalText(120),
    bankName: optionalText(120),
    bankBsb: optionalFormatted(
      (s) => s.replace(/[\s-]/g, ''),
      /^[0-9]{6}$/,
      'BSB must be 6 digits',
    ),
    bankAcc: optionalText(40),
    bankSwift: optionalFormatted(
      (s) => s.toUpperCase().replace(/\s/g, ''),
      /^[A-Z0-9]{8}([A-Z0-9]{3})?$/,
      'SWIFT/BIC must be 8 or 11 alphanumeric characters',
    ),
    bankIban: optionalFormatted(
      (s) => s.toUpperCase().replace(/\s/g, ''),
      /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/,
      'IBAN format invalid',
    ),
  })
  .refine(
    (v) => {
      // AU requires BSB + Acc when filling in. Other countries need
      // enough to route a payment: a SWIFT/BIC, an IBAN, OR a local
      // account number (the NZ case). Empty rows are fine — staff can
      // save partial.
      const filledAny =
        v.bankAccountName ||
        v.bankBsb ||
        v.bankAcc ||
        v.bankSwift ||
        v.bankIban ||
        v.bankName;
      if (!filledAny) return true;
      if (v.bankCountry === 'AU') {
        return Boolean(v.bankBsb && v.bankAcc);
      }
      return Boolean(v.bankSwift || v.bankIban || v.bankAcc);
    },
    {
      message:
        'AU accounts need BSB + Acc. Other countries need a SWIFT/BIC, an IBAN, or a local account number.',
      path: ['bankCountry'],
    },
  );
