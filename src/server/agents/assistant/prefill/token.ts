import crypto from 'node:crypto';
import { requireEnv } from '@/server/env';

/**
 * Signed, short-lived token carrying a prefill payload. Used by both
 * the in-app assistant (TASK-302a) and the WhatsApp router (TASK-302c)
 * so a "log 3h on CAC001" message gets a one-time URL the user can
 * tap to open the form prefilled.
 *
 * Wire format:  base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 *
 * Why HMAC instead of a DB store: the payload is small (<2KB), the
 * URL is the natural carrier, and a signed token has no eviction
 * concerns. Single-use enforcement (so a forwarded link can't be
 * redeemed twice) is best-effort at the form layer via an AuditEvent
 * dedupe check, NOT enforced here.
 *
 * The signing key is derived from AUTH_SECRET so no new env var is
 * needed. Rotating AUTH_SECRET invalidates every outstanding prefill
 * token — good (sessions are invalidated at the same time).
 */

export const PREFILL_TTL_SECONDS = 15 * 60; // 15 minutes
const KEY_DOMAIN = 'assistant-prefill-v1';

export type PrefillKind =
  // Prefill family (TASK-302a / 302b) — token unlocks a prefilled
  // form on the web; the user submits via the form's normal flow.
  | 'timesheet'
  | 'expense'
  | 'bill'
  | 'invoice'
  // Proposal family (TASK-302d) — token represents a pending
  // confirmation card. The user clicks Confirm and the server runs
  // the underlying action directly. No intermediate form.
  | 'recruit_proposal'
  | 'feedback_proposal';

export type PrefillTokenPayload<T = unknown> = {
  /** Schema version — bump if the wire shape changes incompatibly. */
  v: 1;
  /** Which surface this token can be redeemed against. */
  kind: PrefillKind;
  /** Person the token was minted for. Form refuses if the opener differs. */
  personId: string;
  /** Surface-specific data — Zod-validated by the consumer. */
  payload: T;
  /** Issued at (unix seconds). */
  iat: number;
  /** Expires at (unix seconds). */
  exp: number;
  /** Random nonce so repeated mints of the same payload produce
   *  different tokens (helps detect replays at the form layer). */
  jti: string;
};

function signingKey(): Buffer {
  const authSecret = requireEnv('AUTH_SECRET');
  // Derive a 32-byte key bound to a domain string so we never share
  // the same secret with another HMAC use of AUTH_SECRET elsewhere.
  return crypto.createHmac('sha256', authSecret).update(KEY_DOMAIN).digest();
}

function base64urlEncode(bytes: Buffer | string): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
  return buf
    .toString('base64')
    .replace(/=+$/u, '')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_');
}

function base64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/gu, '+').replace(/_/gu, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Mint a token. `nowSeconds` is injected for testability (default Date.now).
 */
export function signPrefillToken<T>(
  input: {
    kind: PrefillKind;
    personId: string;
    payload: T;
    /** Override TTL in seconds. Default `PREFILL_TTL_SECONDS`. */
    ttlSeconds?: number;
  },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const iat = nowSeconds;
  const exp = iat + (input.ttlSeconds ?? PREFILL_TTL_SECONDS);
  const body: PrefillTokenPayload<T> = {
    v: 1,
    kind: input.kind,
    personId: input.personId,
    payload: input.payload,
    iat,
    exp,
    jti: crypto.randomBytes(8).toString('hex'),
  };
  const bodyJson = JSON.stringify(body);
  const bodyB64 = base64urlEncode(bodyJson);
  const sig = crypto.createHmac('sha256', signingKey()).update(bodyB64).digest();
  return `${bodyB64}.${base64urlEncode(sig)}`;
}

export type VerifyResult<T> =
  | { ok: true; payload: PrefillTokenPayload<T> }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_person' | 'wrong_kind' };

/**
 * Verify a token. Pass the expected `personId` (the redeeming user's
 * session person.id) and `kind` (the surface the page expects to
 * hydrate). Returns the parsed payload on success; a structured
 * rejection reason otherwise.
 */
export function verifyPrefillToken<T = unknown>(
  token: string,
  expected: { personId: string; kind: PrefillKind },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult<T> {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [bodyB64, sigB64] = parts;
  if (!bodyB64 || !sigB64) return { ok: false, reason: 'malformed' };

  const expectedSig = crypto
    .createHmac('sha256', signingKey())
    .update(bodyB64)
    .digest();
  const providedSig = base64urlDecode(sigB64);
  if (!constantTimeEqual(expectedSig, providedSig)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let body: PrefillTokenPayload<T>;
  try {
    body = JSON.parse(base64urlDecode(bodyB64).toString('utf8')) as PrefillTokenPayload<T>;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (body.v !== 1 || typeof body.exp !== 'number' || typeof body.personId !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  if (body.exp < nowSeconds) return { ok: false, reason: 'expired' };
  if (body.personId !== expected.personId) return { ok: false, reason: 'wrong_person' };
  if (body.kind !== expected.kind) return { ok: false, reason: 'wrong_kind' };
  return { ok: true, payload: body };
}
