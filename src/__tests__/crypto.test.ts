process.env.AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';

import { describe, it, expect } from 'vitest';
import { encryptText, decryptText, tryDecryptText } from '@/server/crypto';

/**
 * AES-GCM text envelope + the migration-safe `tryDecryptText` used when a
 * column may still hold legacy plaintext (bank details written before the
 * self-service form encrypted them).
 */

describe('encryptText / decryptText', () => {
  it('round-trips and never stores the plaintext', () => {
    const ct = encryptText('062000');
    expect(ct).not.toBe('062000');
    expect(decryptText(ct)).toBe('062000');
  });
  it('produces a fresh IV each call (ciphertext differs)', () => {
    expect(encryptText('12345678')).not.toBe(encryptText('12345678'));
  });
});

describe('tryDecryptText', () => {
  it('decrypts a real ciphertext', () => {
    expect(tryDecryptText(encryptText('12345678'))).toBe('12345678');
  });
  it('passes legacy plaintext through unchanged (bad ciphertext → as-is)', () => {
    expect(tryDecryptText('062000')).toBe('062000');
  });
  it('passes null / empty through', () => {
    expect(tryDecryptText(null)).toBeNull();
    expect(tryDecryptText('')).toBe('');
  });
});
