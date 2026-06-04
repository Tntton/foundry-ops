'use server';

import { z } from 'zod';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import {
  getWhatsAppConfig,
  isWhatsAppConfigured,
  sendWhatsAppText,
} from '@/server/integrations/whatsapp';

const TestInput = z.object({
  toNumber: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{8,16}$/u, 'Use E.164 (e.g. +61400123456) — digits only, optional +'),
  message: z.string().trim().min(1).max(1000),
});

export type WhatsAppTestState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; providerMessageId: string; sentAt: string };

/**
 * Admin-only one-shot to fire a free-form text via the configured
 * WhatsApp number. Used to verify the integration plumbing (creds,
 * webhook, network path) without going through an approval flow.
 *
 * Recipient must be in Meta's verified test-recipient list while
 * Business Verification is pending — otherwise Meta rejects the send
 * with a "recipient not in allowed list" error.
 */
export async function sendWhatsAppTest(
  _prev: WhatsAppTestState,
  formData: FormData,
): Promise<WhatsAppTestState> {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) {
    return { status: 'error', message: 'Not authorized' };
  }
  if (!isWhatsAppConfigured()) {
    return {
      status: 'error',
      message:
        'WhatsApp env vars not set on Vercel. Check WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET.',
    };
  }
  const parsed = TestInput.safeParse({
    toNumber: formData.get('toNumber'),
    message: formData.get('message'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  try {
    const providerMessageId = await sendWhatsAppText(
      parsed.data.toNumber,
      parsed.data.message,
    );
    return {
      status: 'success',
      providerMessageId: providerMessageId ?? '(no id returned)',
      sentAt: new Date().toISOString(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', message: msg };
  }
}

const RegisterInput = z.object({
  pin: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/u, 'PIN must be exactly 6 digits'),
});

export type WhatsAppRegisterState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

/**
 * One-time POST to /{phone-number-id}/register that flips the number's
 * status from "not registered" to "active". Required after adding a
 * number to a WABA before the Cloud API will accept sends. Meta error
 * 133010 ("Account not registered") is the symptom of this not having
 * been done yet.
 *
 * The PIN is the admin's choice — used later as the 2FA step if the
 * number needs to be re-registered or moved. 6 digits, must be
 * non-trivial (no 000000, 123456 etc. — Meta validates).
 */
export async function registerWhatsAppNumber(
  _prev: WhatsAppRegisterState,
  formData: FormData,
): Promise<WhatsAppRegisterState> {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) {
    return { status: 'error', message: 'Not authorized' };
  }
  const cfg = getWhatsAppConfig();
  if (!cfg) {
    return { status: 'error', message: 'WhatsApp env vars not set' };
  }
  const parsed = RegisterInput.safeParse({ pin: formData.get('pin') });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid PIN',
    };
  }

  const url = `https://graph.facebook.com/v22.0/${cfg.phoneNumberId}/register`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        pin: parsed.data.pin,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      return {
        status: 'error',
        message: `Meta rejected the register call (${res.status}): ${body}`,
      };
    }
    return {
      status: 'success',
      message:
        'Registered ✓ — try the Send test message above. If the number was already active, Meta returns success too.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', message: `Register call failed: ${msg}` };
  }
}
