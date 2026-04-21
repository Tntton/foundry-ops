import { NextResponse } from 'next/server';
import {
  processInvoiceEvent,
  verifyXeroSignature,
  type XeroWebhookPayload,
} from '@/server/integrations/xero-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Xero webhook endpoint.
 *
 * Xero posts a JSON body and signs it with HMAC-SHA256 using the webhook
 * signing key from the developer portal. We MUST return the exact response
 * Xero expects for signature verification to pass:
 *   - Valid signature → 200 OK (empty body)
 *   - Invalid signature → 401 Unauthorized (empty body, no retry)
 *   - Anything else (including 500) → Xero retries the event, which is fine
 *
 * Configure in Xero dev portal:
 *   URL:      https://foundry-ops.vercel.app/api/integrations/xero/webhook
 *   Events:   Invoices, Bills (ACCPAY invoices come through as INVOICE events
 *             with Type=ACCPAY)
 *   Key:      copy into env as XERO_WEBHOOK_KEY (rotate and re-save if leaked)
 *
 * The initial "Intent to receive" callback from Xero will be a body of `{}`
 * or similar small payload — signature verification still applies.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get('x-xero-signature');

  if (!verifyXeroSignature(raw, sig)) {
    // IMPORTANT: must be exactly 401 with no body for Xero's "Intent to
    // receive" handshake to report a misconfiguration cleanly. Don't leak
    // which part failed — avoid feedback on the signing key.
    return new NextResponse(null, { status: 401 });
  }

  // Past signature verification; parse and process events.
  let payload: XeroWebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 200 }); // Xero's intent-to-receive
  }

  const events = payload.events ?? [];
  const results = [];
  for (const event of events) {
    if (event.eventCategory === 'INVOICE') {
      try {
        const outcome = await processInvoiceEvent(event);
        results.push({ id: event.resourceId, ...outcome });
      } catch (err) {
        console.error('[xero-webhook] event handler failed:', event, err);
        results.push({ id: event.resourceId, kind: 'error', reason: 'handler threw' });
      }
    } else {
      // We don't act on CONTACT / CREDITNOTE yet — log for visibility.
      results.push({ id: event.resourceId, kind: 'skipped', reason: event.eventCategory });
    }
  }
  console.log('[xero-webhook]', {
    seqStart: payload.firstEventSequence,
    seqEnd: payload.lastEventSequence,
    processed: results,
  });

  // Xero expects 200 once the signature is verified, regardless of per-event
  // handler outcome. Failures are retried via eventual consistency — we'll
  // catch the same resourceId in a future UPDATE.
  return new NextResponse(null, { status: 200 });
}
