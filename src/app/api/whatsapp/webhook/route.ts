import {
  isWhatsAppConfigured,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from '@/server/integrations/whatsapp';
import {
  handleIncomingWhatsAppMessage,
  type IncomingMessage,
} from '@/server/integrations/whatsapp-router';

/**
 * Meta WhatsApp Cloud API webhook endpoint.
 *
 *   GET  — verification challenge: Meta calls with hub.mode=subscribe,
 *          we echo hub.challenge if our verify_token matches.
 *   POST — actual delivery of inbound messages + status updates. Meta
 *          signs the raw body with our app secret; we verify before
 *          parsing. The route returns 200 even on internal failures —
 *          Meta retries aggressively on non-2xx, which would flood the
 *          inbox with duplicates. We log + drop instead.
 */

export const dynamic = 'force-dynamic';
// The expense flow awaits media download + Sonnet OCR inline before
// replying, which can take 10-20s. Give the function room to finish so
// it isn't killed mid-OCR (a kill would send no reply AND trigger a Meta
// retry). Re-delivery duplicates are guarded by the providerId dedupe in
// handleIncomingWhatsAppMessage.
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const result = verifyWebhookChallenge(mode, token, challenge);
  if (!result.ok) {
    return new Response(result.reason, { status: 403 });
  }
  return new Response(result.challenge, { status: 200 });
}

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
          document?: { id?: string; mime_type?: string; caption?: string };
          audio?: { id?: string; mime_type?: string };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          recipient_id?: string;
        }>;
      };
    }>;
  }>;
};

export async function POST(request: Request): Promise<Response> {
  if (!isWhatsAppConfigured()) {
    // Quietly accept so Meta doesn't retry; nothing for us to do.
    return new Response('not configured', { status: 200 });
  }
  // Meta signs the raw body — we have to read it once as text and only
  // parse JSON after verification.
  const raw = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  if (!verifyWebhookSignature(raw, signature)) {
    console.warn('[whatsapp.webhook] signature mismatch');
    return new Response('signature mismatch', { status: 401 });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(raw) as WhatsAppWebhookPayload;
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const messages: IncomingMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;
      for (const m of value.messages) {
        if (!m.id || !m.from) continue;
        const fromE164 = m.from.startsWith('+') ? m.from : `+${m.from}`;
        const ts = m.timestamp ? Number(m.timestamp) : null;
        const receivedAt =
          ts && Number.isFinite(ts) ? new Date(ts * 1000) : new Date();
        if (m.type === 'text') {
          messages.push({
            providerId: m.id,
            fromPhone: fromE164,
            receivedAt,
            text: m.text?.body ?? null,
            mediaId: null,
            mediaMimeType: null,
          });
        } else if (m.type === 'image') {
          messages.push({
            providerId: m.id,
            fromPhone: fromE164,
            receivedAt,
            text: m.image?.caption ?? null,
            mediaId: m.image?.id ?? null,
            mediaMimeType: m.image?.mime_type ?? null,
          });
        } else if (m.type === 'document') {
          messages.push({
            providerId: m.id,
            fromPhone: fromE164,
            receivedAt,
            text: m.document?.caption ?? null,
            mediaId: m.document?.id ?? null,
            mediaMimeType: m.document?.mime_type ?? null,
          });
        }
        // audio + other types: drop on the floor for now — not in the
        // first-pass scope. Meta's status events are also dropped (we
        // don't currently surface delivery status anywhere).
      }
    }
  }

  // Process messages sequentially. Each handler is small, but they
  // share one DB connection pool and we want strict per-message order
  // for multi-turn flows.
  for (const m of messages) {
    try {
      await handleIncomingWhatsAppMessage(m);
    } catch (err) {
      console.error('[whatsapp.webhook] handler failed:', err);
      // Don't return non-200 — Meta would retry and we'd double-act on
      // the same wamid. Errors are logged (and the inbound message is
      // still persisted via logMessage in the router for replay).
    }
  }

  return new Response('ok', { status: 200 });
}
