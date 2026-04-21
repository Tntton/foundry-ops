import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { verifyXeroSignature } from '@/server/integrations/xero-webhook';

const ORIGINAL_KEY = process.env['XERO_WEBHOOK_KEY'];

describe('verifyXeroSignature', () => {
  beforeEach(() => {
    process.env['XERO_WEBHOOK_KEY'] = 'test-secret-key';
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['XERO_WEBHOOK_KEY'];
    else process.env['XERO_WEBHOOK_KEY'] = ORIGINAL_KEY;
  });

  function sign(body: string, key = 'test-secret-key'): string {
    return crypto.createHmac('sha256', key).update(body, 'utf8').digest('base64');
  }

  it('accepts a correctly-signed body', () => {
    const body = '{"events":[]}';
    expect(verifyXeroSignature(body, sign(body))).toBe(true);
  });

  it('rejects a body signed with the wrong key', () => {
    const body = '{"events":[]}';
    expect(verifyXeroSignature(body, sign(body, 'wrong-key'))).toBe(false);
  });

  it('rejects a tampered body', () => {
    const body = '{"events":[]}';
    const sig = sign(body);
    const tamperedBody = '{"events":[{"fake":true}]}';
    expect(verifyXeroSignature(tamperedBody, sig)).toBe(false);
  });

  it('rejects when header is missing', () => {
    expect(verifyXeroSignature('{}', null)).toBe(false);
    expect(verifyXeroSignature('{}', '')).toBe(false);
  });

  it('rejects when XERO_WEBHOOK_KEY is not set', () => {
    delete process.env['XERO_WEBHOOK_KEY'];
    const body = '{}';
    const sig = crypto
      .createHmac('sha256', 'whatever')
      .update(body)
      .digest('base64');
    expect(verifyXeroSignature(body, sig)).toBe(false);
  });

  it('handles length-mismatched headers in constant time', () => {
    const body = '{}';
    expect(verifyXeroSignature(body, 'short')).toBe(false);
    expect(verifyXeroSignature(body, 'a'.repeat(1000))).toBe(false);
  });
});
