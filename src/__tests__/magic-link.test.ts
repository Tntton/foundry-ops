import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '@/server/magic-link';

describe('magic-link token primitives', () => {
  describe('generateToken', () => {
    it('produces base64url strings', () => {
      const t = generateToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces 32 bytes (43 chars in base64url, no padding)', () => {
      expect(generateToken()).toHaveLength(43);
    });

    it('is effectively unique across calls', () => {
      const set = new Set<string>();
      for (let i = 0; i < 100; i += 1) set.add(generateToken());
      expect(set.size).toBe(100);
    });
  });

  describe('hashToken', () => {
    it('is deterministic', () => {
      expect(hashToken('hello')).toBe(hashToken('hello'));
    });

    it('differs for different inputs', () => {
      expect(hashToken('a')).not.toBe(hashToken('b'));
    });

    it('produces 64 hex chars (sha256)', () => {
      expect(hashToken('anything')).toMatch(/^[a-f0-9]{64}$/);
    });

    it('does not leak the raw token', () => {
      const token = 'super-secret-token-value';
      expect(hashToken(token)).not.toContain(token);
    });
  });
});
