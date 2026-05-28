import { describe, it, expect } from 'vitest';
import { parseRiderEmailFromFilename } from '@/server/integrations/uber-email-intake';

/**
 * The email-intake's rider match depends on the Power Automate flow
 * encoding the rider's email as a filename prefix. These checks pin
 * the prefix parser so a flow-recipe edit (changing the delimiter,
 * relaxing the email shape) doesn't silently break attribution.
 */
describe('parseRiderEmailFromFilename', () => {
  it('extracts a foundry.health rider email from the double-underscore prefix', () => {
    expect(
      parseRiderEmailFromFilename('julia@foundry.health__receipt-1f3a.pdf'),
    ).toBe('julia@foundry.health');
  });

  it('lowercases the email so case-quirks in the original `To:` header do not miss the Person.email match', () => {
    expect(
      parseRiderEmailFromFilename('Trung@Foundry.Health__Uber Receipt 2026-05-28.pdf'),
    ).toBe('trung@foundry.health');
  });

  it('accepts the longer firstname.lastname@foundry.health convention used by Navan / Entra', () => {
    expect(
      parseRiderEmailFromFilename('julia.maguire@foundry.health__rcpt.pdf'),
    ).toBe('julia.maguire@foundry.health');
  });

  it('returns null on a plain Uber filename so the OCR fallback can kick in', () => {
    expect(parseRiderEmailFromFilename('receipt-1f3a-uber.pdf')).toBeNull();
  });

  it('returns null when the candidate prefix has no @ or no domain dot', () => {
    expect(parseRiderEmailFromFilename('notanemail__rcpt.pdf')).toBeNull();
    expect(parseRiderEmailFromFilename('julia@foundryhealth__rcpt.pdf')).toBeNull();
  });

  it('returns null when there is no delimiter at all', () => {
    expect(parseRiderEmailFromFilename('uber-trip.pdf')).toBeNull();
  });
});
