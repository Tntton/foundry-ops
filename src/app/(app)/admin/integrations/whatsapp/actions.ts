'use server';

import { z } from 'zod';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import {
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
