import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { requireEnv } from '@/server/env';

/**
 * AES-256-GCM envelope encryption for secrets we have to keep in the DB
 * (integration refresh tokens, long-term service creds, etc.). Key is
 * derived from AUTH_SECRET via scrypt so rotating AUTH_SECRET forces a
 * re-encryption — which is the right coupling for a consulting-ops app
 * without a separate KMS.
 *
 * Format (all concatenated, then base64-encoded):
 *   [ iv: 12 bytes ][ authTag: 16 bytes ][ ciphertext: variable ]
 */

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const SALT = 'foundry-ops/integration-tokens/v1';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = scryptSync(requireEnv('AUTH_SECRET'), SALT, 32);
  return cachedKey;
}

export function encryptJson(data: unknown): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, getKey(), iv);
  const payload = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, payload]).toString('base64');
}

export function decryptJson<T>(ciphertext: string): T {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const payload = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(payload), decipher.final()]).toString(
    'utf8',
  );
  return JSON.parse(plaintext) as T;
}
