import { NextResponse } from 'next/server';
import type { EnvelopeStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import {
  verifyDocuSignWebhookSignature,
  getDocuSignHmacSecret,
} from '@/server/integrations/docusign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Connect callbacks are usually < 100ms; bump to 60s as headroom
// for the post-completion document download (when we add it).
export const maxDuration = 60;

/**
 * DocuSign Connect webhook receiver.
 *
 * Configured at DocuSign Admin → Connect → Add Configuration with:
 *   - URL: https://<deploy>/api/docusign/webhook
 *   - Event source: REST API v2.1
 *   - Event delivery mode: SIM (default — single envelope per POST)
 *   - Trigger events: Envelope Sent, Delivered, Completed,
 *     Declined, Voided (the lifecycle events we care about).
 *   - Include HMAC: enabled. HMAC secret is the one pasted into
 *     Foundry's connect form.
 *
 * Body format: JSON envelope of `{ event, data: { envelopeSummary,
 * envelopeId, ... } }`. The `envelopeSummary.status` field is the
 * canonical state we mirror onto DocuSignEnvelope.status.
 *
 * Per-recipient detail is sent too, but for v1 we only update the
 * envelope-level status. Richer recipient tracking can be added
 * later by parsing `data.envelopeSummary.recipients`.
 */

const STATUS_MAP: Record<string, EnvelopeStatus> = {
  sent: 'sent',
  delivered: 'delivered',
  completed: 'completed',
  declined: 'declined',
  voided: 'voided',
  // DocuSign also reports 'signed' on a per-recipient basis — at
  // the envelope level we only flip to 'completed' once everyone
  // has signed, which DocuSign reports separately. So 'signed'
  // never appears here.
};

export async function POST(req: Request) {
  // Read the raw body BEFORE parsing — HMAC must hash exactly the
  // bytes DocuSign signed, including whitespace + key ordering.
  const rawBody = await req.text();
  const signatureHeader =
    req.headers.get('x-docusign-signature-1') ??
    req.headers.get('X-DocuSign-Signature-1');

  const hmacSecret = await getDocuSignHmacSecret();
  if (!hmacSecret) {
    // No connection or no HMAC secret stored → reject silently.
    // We don't want to leak whether the integration exists to an
    // unauthenticated caller.
    console.warn('[docusign.webhook] no HMAC secret — integration not configured');
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!verifyDocuSignWebhookSignature(rawBody, signatureHeader, hmacSecret)) {
    console.warn('[docusign.webhook] HMAC verification failed');
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    console.error('[docusign.webhook] payload parse failed:', err);
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Defensive extraction — DocuSign's payload shape has shifted
  // across API versions; we accept either `data.envelopeId` (REST
  // v2.1) or `envelopeStatus.envelopeId` (legacy). Same for status.
  const envelopeId = extractEnvelopeId(parsed);
  const statusRaw = extractStatus(parsed);
  if (!envelopeId || !statusRaw) {
    console.warn('[docusign.webhook] missing envelopeId or status', { envelopeId, statusRaw });
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const nextStatus = STATUS_MAP[statusRaw.toLowerCase()];
  if (!nextStatus) {
    // Unknown / uninteresting status — log + 200 so DocuSign
    // doesn't retry.
    console.info(`[docusign.webhook] ignoring status="${statusRaw}" for ${envelopeId}`);
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const envelope = await prisma.docuSignEnvelope.findUnique({
    where: { externalEnvelopeId: envelopeId },
  });
  if (!envelope) {
    // Webhook for an envelope we don't recognise — this is normal
    // during the first few seconds after send (race between
    // POST response landing locally and Connect firing the 'sent'
    // event). Return 200 so DocuSign retries are gentle.
    console.info(`[docusign.webhook] unknown envelope ${envelopeId} — accepting`);
    return NextResponse.json({ ok: true, unknown: true }, { status: 200 });
  }

  const terminal =
    nextStatus === 'completed' ||
    nextStatus === 'declined' ||
    nextStatus === 'voided';
  await prisma.docuSignEnvelope.update({
    where: { id: envelope.id },
    data: {
      status: nextStatus,
      ...(terminal && envelope.completedAt === null
        ? { completedAt: new Date() }
        : {}),
    },
  });

  // TODO: when status === 'completed', download the signed PDF
  // from DocuSign's combined-doc endpoint + upload to SharePoint
  // admin folder + set signedDocSharepointUrl. Wired in the next
  // phase — for now we only track state.

  console.log(`[docusign.webhook] envelope ${envelopeId} → ${nextStatus}`);
  return NextResponse.json({ ok: true }, { status: 200 });
}

function extractEnvelopeId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  // REST v2.1 shape
  const data = p['data'];
  if (data && typeof data === 'object') {
    const id = (data as Record<string, unknown>)['envelopeId'];
    if (typeof id === 'string') return id;
  }
  // Legacy "envelopeStatus" wrapper
  const env = p['envelopeStatus'];
  if (env && typeof env === 'object') {
    const id = (env as Record<string, unknown>)['envelopeId'];
    if (typeof id === 'string') return id;
  }
  // Flat top-level (rare)
  const flat = p['envelopeId'];
  return typeof flat === 'string' ? flat : null;
}

function extractStatus(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  // Top-level event name (REST v2.1)
  const event = p['event'];
  if (typeof event === 'string') {
    // Events look like "envelope-completed" / "envelope-sent".
    // Strip the prefix.
    const m = event.match(/^envelope-(.+)$/);
    if (m) return m[1] ?? null;
  }
  // data.envelopeSummary.status
  const data = p['data'];
  if (data && typeof data === 'object') {
    const summary = (data as Record<string, unknown>)['envelopeSummary'];
    if (summary && typeof summary === 'object') {
      const s = (summary as Record<string, unknown>)['status'];
      if (typeof s === 'string') return s;
    }
  }
  // Legacy
  const env = p['envelopeStatus'];
  if (env && typeof env === 'object') {
    const s = (env as Record<string, unknown>)['status'];
    if (typeof s === 'string') return s;
  }
  return null;
}
