import { describe, it, expect, beforeAll } from 'vitest';
import {
  signPrefillToken,
  verifyPrefillToken,
  PREFILL_TTL_SECONDS,
} from '@/server/agents/assistant/prefill/token';

beforeAll(() => {
  // The token signing key derives from AUTH_SECRET.
  // Set a deterministic value here so the tests are stable.
  process.env.AUTH_SECRET = 'test-secret-do-not-use-in-prod';
});

describe('prefill token — sign + verify round-trip', () => {
  it('signs and verifies a valid token', () => {
    const token = signPrefillToken({
      kind: 'timesheet',
      personId: 'p_alice',
      payload: { entries: [{ projectCode: 'CAC001', dateIso: '2026-06-04', hours: 3 }] },
    });
    const verify = verifyPrefillToken(token, {
      personId: 'p_alice',
      kind: 'timesheet',
    });
    expect(verify.ok).toBe(true);
    if (verify.ok) {
      expect(verify.payload.kind).toBe('timesheet');
      expect(verify.payload.personId).toBe('p_alice');
      expect(verify.payload.exp).toBeGreaterThan(verify.payload.iat);
    }
  });

  it('rejects a token minted for a different person', () => {
    const token = signPrefillToken({
      kind: 'timesheet',
      personId: 'p_alice',
      payload: { entries: [] },
    });
    const verify = verifyPrefillToken(token, {
      personId: 'p_bob',
      kind: 'timesheet',
    });
    expect(verify.ok).toBe(false);
    if (!verify.ok) expect(verify.reason).toBe('wrong_person');
  });

  it('rejects a token for the wrong surface', () => {
    const token = signPrefillToken({
      kind: 'timesheet',
      personId: 'p_alice',
      payload: { entries: [] },
    });
    const verify = verifyPrefillToken(token, {
      personId: 'p_alice',
      kind: 'expense',
    });
    expect(verify.ok).toBe(false);
    if (!verify.ok) expect(verify.reason).toBe('wrong_kind');
  });

  it('rejects an expired token', () => {
    const now = 1_700_000_000;
    const token = signPrefillToken(
      {
        kind: 'timesheet',
        personId: 'p_alice',
        payload: { entries: [] },
      },
      now,
    );
    const later = now + PREFILL_TTL_SECONDS + 1;
    const verify = verifyPrefillToken(
      token,
      { personId: 'p_alice', kind: 'timesheet' },
      later,
    );
    expect(verify.ok).toBe(false);
    if (!verify.ok) expect(verify.reason).toBe('expired');
  });

  it('rejects a tampered token (signature mismatch)', () => {
    const token = signPrefillToken({
      kind: 'timesheet',
      personId: 'p_alice',
      payload: { entries: [] },
    });
    const parts = token.split('.');
    expect(parts.length).toBe(2);
    // Flip a character in the body.
    const body = parts[0]!;
    const swapped = body.startsWith('A')
      ? `B${body.slice(1)}`
      : `A${body.slice(1)}`;
    const tampered = `${swapped}.${parts[1]}`;
    const verify = verifyPrefillToken(tampered, {
      personId: 'p_alice',
      kind: 'timesheet',
    });
    expect(verify.ok).toBe(false);
    if (!verify.ok) {
      // Could be 'bad_signature' or 'malformed' depending on how the
      // tampered body parses. Either is acceptable — both are rejection.
      expect(['bad_signature', 'malformed']).toContain(verify.reason);
    }
  });

  it('rejects a token with garbage shape', () => {
    const verify = verifyPrefillToken('not.a.real.token', {
      personId: 'p_alice',
      kind: 'timesheet',
    });
    expect(verify.ok).toBe(false);
  });

  it('rejects an empty string', () => {
    const verify = verifyPrefillToken('', {
      personId: 'p_alice',
      kind: 'timesheet',
    });
    expect(verify.ok).toBe(false);
  });

  it('each sign produces a different token (jti nonce)', () => {
    const a = signPrefillToken({
      kind: 'timesheet',
      personId: 'p_alice',
      payload: { entries: [] },
    });
    const b = signPrefillToken({
      kind: 'timesheet',
      personId: 'p_alice',
      payload: { entries: [] },
    });
    expect(a).not.toBe(b);
  });
});
