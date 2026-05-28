import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * WhatsApp Cloud API client (Meta Graph API). Handles outbound text +
 * media messages, webhook verification challenge, signature checking
 * for inbound POSTs, and media download.
 *
 * Env required to enable:
 *   - WHATSAPP_ACCESS_TOKEN       — long-lived system-user access token
 *   - WHATSAPP_PHONE_NUMBER_ID    — Meta's phone-number-id, not the E.164
 *   - WHATSAPP_VERIFY_TOKEN       — string we set in the webhook config;
 *                                    Meta echoes it back on subscribe
 *   - WHATSAPP_APP_SECRET         — used for `X-Hub-Signature-256` HMAC
 *                                    so we can verify Meta is the caller
 *
 * Anything posting to mutating endpoints checks `isWhatsAppConfigured()`
 * first; without it the integration runs in no-op mode (logs and skips).
 */

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export type WhatsAppConfig = {
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
};

export function getWhatsAppConfig(): WhatsAppConfig | null {
  const accessToken = process.env['WHATSAPP_ACCESS_TOKEN'];
  const phoneNumberId = process.env['WHATSAPP_PHONE_NUMBER_ID'];
  const verifyToken = process.env['WHATSAPP_VERIFY_TOKEN'];
  const appSecret = process.env['WHATSAPP_APP_SECRET'];
  if (!accessToken || !phoneNumberId || !verifyToken || !appSecret) {
    return null;
  }
  return { accessToken, phoneNumberId, verifyToken, appSecret };
}

export function isWhatsAppConfigured(): boolean {
  return getWhatsAppConfig() !== null;
}

/**
 * Verify the webhook subscription challenge — Meta hits the GET endpoint
 * with `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. Echo
 * the challenge back when the verify_token matches.
 */
export function verifyWebhookChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null,
): { ok: true; challenge: string } | { ok: false; reason: string } {
  if (mode !== 'subscribe') {
    return { ok: false, reason: 'mode must be subscribe' };
  }
  const cfg = getWhatsAppConfig();
  if (!cfg) return { ok: false, reason: 'WhatsApp not configured' };
  if (!token || token !== cfg.verifyToken) {
    return { ok: false, reason: 'verify token mismatch' };
  }
  if (!challenge) return { ok: false, reason: 'no challenge' };
  return { ok: true, challenge };
}

/**
 * Constant-time signature check on the inbound webhook body. Meta signs
 * the raw payload with the app secret using HMAC-SHA256; we re-sign and
 * compare. Reject any inbound that doesn't carry a matching header.
 */
export function verifyWebhookSignature(
  rawBody: string,
  headerSignature: string | null,
): boolean {
  const cfg = getWhatsAppConfig();
  if (!cfg) return false;
  if (!headerSignature) return false;
  const expected = `sha256=${createHmac('sha256', cfg.appSecret)
    .update(rawBody)
    .digest('hex')}`;
  // timingSafeEqual requires same-length buffers — pad / fail fast.
  if (expected.length !== headerSignature.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(headerSignature),
    );
  } catch {
    return false;
  }
}

/**
 * Send a plain text reply. Returns the provider's wamid on success
 * (string) or null when WhatsApp isn't configured. Throws on transport
 * / auth errors so the caller can surface them.
 */
export async function sendWhatsAppText(
  toPhoneE164: string,
  body: string,
): Promise<string | null> {
  const cfg = getWhatsAppConfig();
  if (!cfg) {
    console.warn(
      '[whatsapp.send] skipped — integration not configured:',
      toPhoneE164,
      body.slice(0, 60),
    );
    return null;
  }
  // Meta's API expects the phone without the leading "+".
  const to = toPhoneE164.replace(/^\+/, '');
  const res = await fetch(
    `${GRAPH_BASE}/${cfg.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body, preview_url: false },
      }),
    },
  );
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`whatsapp send failed: ${res.status} ${errBody}`);
  }
  const json = (await res.json()) as {
    messages?: Array<{ id?: string }>;
  };
  return json.messages?.[0]?.id ?? null;
}

/**
 * Download a media file Meta has hosted (after we receive a media-type
 * inbound message). Two-step:
 *   1. Resolve the media URL via /{media-id}
 *   2. GET the URL with the access token
 *
 * Returns `{ buffer, mimeType }` or null when the integration isn't
 * configured.
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const cfg = getWhatsAppConfig();
  if (!cfg) return null;
  const lookup = await fetch(`${GRAPH_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
  });
  if (!lookup.ok) {
    throw new Error(`media lookup failed: ${lookup.status}`);
  }
  const meta = (await lookup.json()) as {
    url?: string;
    mime_type?: string;
  };
  if (!meta.url) throw new Error('media metadata missing url');
  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
  });
  if (!fileRes.ok) {
    throw new Error(`media download failed: ${fileRes.status}`);
  }
  const arr = await fileRes.arrayBuffer();
  return {
    buffer: Buffer.from(arr),
    mimeType: meta.mime_type ?? 'application/octet-stream',
  };
}
