import crypto from 'node:crypto';
import type { BillStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { optionalEnv } from '@/server/env';

export type XeroWebhookEvent = {
  resourceUrl: string;
  resourceId: string;
  eventDateUtc: string;
  eventType: 'CREATE' | 'UPDATE';
  eventCategory: 'INVOICE' | 'CONTACT' | 'CREDITNOTE';
  tenantId: string;
  tenantType: 'ORGANISATION';
};

export type XeroWebhookPayload = {
  events: XeroWebhookEvent[];
  firstEventSequence: number;
  lastEventSequence: number;
  entropy?: string;
};

/**
 * Verify a Xero webhook signature. Xero sends an HMAC-SHA256 of the raw
 * request body keyed by the webhook signing key, base64-encoded, in the
 * `x-xero-signature` header. Returns true iff it matches.
 *
 * See: https://developer.xero.com/documentation/guides/webhooks/overview
 */
export function verifyXeroSignature(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const key = optionalEnv('XERO_WEBHOOK_KEY');
  if (!key) return false;
  const computed = crypto
    .createHmac('sha256', key)
    .update(rawBody, 'utf8')
    .digest('base64');
  // Constant-time compare to avoid timing attacks.
  if (computed.length !== header.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(header));
}

/**
 * Fetch the latest state of a Xero invoice by ID and return just the bits
 * we care about for status sync (status, totals, paid amount).
 */
async function fetchXeroInvoice(resourceId: string): Promise<{
  InvoiceID: string;
  Type: 'ACCREC' | 'ACCPAY';
  Status: string;
  AmountPaid?: number;
  Total?: number;
} | null> {
  const { xeroRequest } = await import('@/server/integrations/xero');
  try {
    const res = await xeroRequest<{
      Invoices: Array<{
        InvoiceID: string;
        Type: 'ACCREC' | 'ACCPAY';
        Status: string;
        AmountPaid?: number;
        Total?: number;
      }>;
    }>('GET', `/api.xro/2.0/Invoices/${resourceId}`);
    return res.Invoices[0] ?? null;
  } catch (err) {
    console.error('[xero-webhook] fetch invoice failed:', resourceId, err);
    return null;
  }
}

/**
 * Map a Xero invoice Status back to our local Invoice.status. Xero's states
 * (DRAFT / SUBMITTED / AUTHORISED / PAID / VOIDED / DELETED) don't 1:1 map
 * to ours — we pick the closest meaningful local state.
 */
function mapInvoiceStatus(xeroStatus: string): string | null {
  switch (xeroStatus) {
    case 'AUTHORISED':
      return 'sent';
    case 'PAID':
      return 'paid';
    case 'VOIDED':
    case 'DELETED':
      return 'written_off';
    default:
      return null;
  }
}

function mapBillStatus(xeroStatus: string): BillStatus | null {
  switch (xeroStatus) {
    case 'PAID':
      return 'paid';
    case 'VOIDED':
    case 'DELETED':
      return 'rejected';
    default:
      return null;
  }
}

/**
 * Process a single invoice event. Looks up our local Invoice or Bill by the
 * Xero resource id, fetches the authoritative state from Xero, and syncs
 * status + paid amount back. Silently skips when we don't have a local row
 * (e.g. the invoice was created in Xero directly).
 */
export async function processInvoiceEvent(event: XeroWebhookEvent): Promise<
  | { kind: 'synced'; entityType: 'invoice' | 'bill'; localId: string; newStatus: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'error'; reason: string }
> {
  const xero = await fetchXeroInvoice(event.resourceId);
  if (!xero) return { kind: 'error', reason: 'could not fetch from Xero' };

  if (xero.Type === 'ACCREC') {
    const invoice = await prisma.invoice.findUnique({
      where: { xeroInvoiceId: event.resourceId },
      select: { id: true, status: true, paymentReceivedAmount: true, amountTotal: true },
    });
    if (!invoice) {
      return { kind: 'skipped', reason: 'no local invoice row for this Xero id' };
    }

    const mapped = mapInvoiceStatus(xero.Status);
    if (!mapped) {
      return { kind: 'skipped', reason: `unmapped status ${xero.Status}` };
    }

    const paidCents = Math.round((xero.AmountPaid ?? 0) * 100);
    const updates: Record<string, unknown> = {};
    if (mapped !== invoice.status) updates['status'] = mapped;
    if (paidCents !== (invoice.paymentReceivedAmount ?? 0)) {
      updates['paymentReceivedAmount'] = paidCents;
    }
    if (mapped === 'paid' && paidCents >= invoice.amountTotal) {
      updates['paidAt'] = new Date();
    }

    if (Object.keys(updates).length === 0) {
      return { kind: 'skipped', reason: 'no change' };
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: invoice.id }, data: updates });
      await writeAudit(tx, {
        actor: { type: 'agent', id: 'xero_webhook' },
        action: 'xero_synced',
        entity: {
          type: 'invoice',
          id: invoice.id,
          before: { status: invoice.status, paidCents: invoice.paymentReceivedAmount ?? 0 },
          after: { ...updates, xeroStatus: xero.Status },
        },
        source: 'integration_sync',
      });
    });
    return { kind: 'synced', entityType: 'invoice', localId: invoice.id, newStatus: mapped };
  }

  // ACCPAY → Bill
  const bill = await prisma.bill.findUnique({
    where: { xeroBillId: event.resourceId },
    select: { id: true, status: true },
  });
  if (!bill) {
    return { kind: 'skipped', reason: 'no local bill row for this Xero id' };
  }
  const mapped = mapBillStatus(xero.Status);
  if (!mapped || mapped === bill.status) {
    return { kind: 'skipped', reason: 'unmapped status or no change' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.bill.update({ where: { id: bill.id }, data: { status: mapped } });
    await writeAudit(tx, {
      actor: { type: 'agent', id: 'xero_webhook' },
      action: 'xero_synced',
      entity: {
        type: 'bill',
        id: bill.id,
        before: { status: bill.status },
        after: { status: mapped, xeroStatus: xero.Status },
      },
      source: 'integration_sync',
    });
  });
  return { kind: 'synced', entityType: 'bill', localId: bill.id, newStatus: mapped };
}
