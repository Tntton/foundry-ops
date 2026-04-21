'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { getXeroIntegration } from '@/server/integrations/xero';
import { pushInvoiceToXero } from '@/server/integrations/xero-invoices';

export type InvoiceXeroPushState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

export async function pushInvoiceXero(
  invoiceId: string,
  _prev: InvoiceXeroPushState,
  _formData: FormData,
): Promise<InvoiceXeroPushState> {
  const session = await getSession();
  try {
    requireCapability(session, 'invoice.send');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const xeroRow = await getXeroIntegration();
  if (!xeroRow || xeroRow.status !== 'connected') {
    return {
      status: 'error',
      message: 'Xero not connected. Connect at /admin/integrations/xero first.',
    };
  }

  try {
    const xeroInvoiceId = await pushInvoiceToXero(invoiceId);
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'xero_pushed',
        entity: {
          type: 'invoice',
          id: invoiceId,
          after: { xeroInvoiceId },
        },
        source: 'web',
      });
    });
    revalidatePath(`/invoices/${invoiceId}`);
    return {
      status: 'success',
      message: `Pushed to Xero (${xeroInvoiceId.slice(0, 8)}…).`,
    };
  } catch (err) {
    console.error('[invoice.xero-push] failed:', err);
    return {
      status: 'error',
      message: `Push failed: ${(err as Error).message}`,
    };
  }
}

export type InvoiceDeleteState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

/**
 * Delete a draft / pending_approval invoice. Once approved the invoice has
 * been pushed to Xero and timesheets may reference it via billedInvoiceId —
 * use Xero's void flow (and the local action layer then reconciles). Lines,
 * milestone invoice pointers, and any pending approval row cascade cleanly.
 */
export async function deleteDraftInvoice(
  invoiceId: string,
  _prev: InvoiceDeleteState,
  _formData: FormData,
): Promise<InvoiceDeleteState> {
  const session = await getSession();
  try {
    requireCapability(session, 'invoice.delete_draft');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      number: true,
      status: true,
      projectId: true,
      clientId: true,
      amountTotal: true,
    },
  });
  if (!invoice) return { status: 'error', message: 'Invoice not found' };

  if (invoice.status !== 'draft' && invoice.status !== 'pending_approval') {
    return {
      status: 'error',
      message: `Can't delete — invoice is ${invoice.status}. Void it in Xero instead.`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'deleted',
        entity: {
          type: 'invoice',
          id: invoice.id,
          before: {
            number: invoice.number,
            status: invoice.status,
            amountTotal: invoice.amountTotal,
          },
          after: null,
        },
        source: 'web',
      });
      // Clear the pending approval if there is one (no FK, so it would orphan).
      await tx.approval.deleteMany({
        where: { subjectType: 'invoice', subjectId: invoice.id },
      });
      // Unlink any milestone that pointed at this draft.
      await tx.milestone.updateMany({
        where: { invoiceId: invoice.id },
        data: { invoiceId: null },
      });
      // Invoice lines cascade via FK.
      await tx.invoice.delete({ where: { id: invoice.id } });
    });
  } catch (err) {
    console.error('[invoice.delete_draft] failed:', err);
    return { status: 'error', message: 'Delete failed — try again.' };
  }

  revalidatePath('/invoices');
  redirect('/invoices?deleted=1');
}

export type InvoiceTransitionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

/**
 * Mark an approved invoice as sent. No email is sent from Foundry Ops —
 * this is a local status flip + audit. Sending happens in Xero.
 */
export async function markInvoiceSent(
  invoiceId: string,
  _prev: InvoiceTransitionState,
  _formData: FormData,
): Promise<InvoiceTransitionState> {
  const session = await getSession();
  try {
    requireCapability(session, 'invoice.send');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, number: true, status: true, sentAt: true },
  });
  if (!invoice) return { status: 'error', message: 'Invoice not found' };
  if (invoice.status !== 'approved') {
    return {
      status: 'error',
      message: `Can't mark sent — invoice is ${invoice.status}. Only approved invoices can transition to sent.`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'sent', sentAt: new Date() },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'marked_sent',
        entity: {
          type: 'invoice',
          id: invoiceId,
          before: { status: invoice.status, sentAt: invoice.sentAt?.toISOString() ?? null },
          after: { status: 'sent' },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[invoice.markSent] failed:', err);
    return { status: 'error', message: 'Transition failed — try again.' };
  }

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${invoiceId}`);
  return { status: 'success', message: `${invoice.number} marked sent.` };
}

const RecordPaymentSchema = z.object({
  amountDollars: z.coerce.number().min(0.01).max(10_000_000),
  paidOn: z.coerce.date().optional(),
});

/**
 * Record a payment against an invoice. Handles partial → full transitions:
 *   - Payment < outstanding → status partial, paymentReceivedAmount += amount
 *   - Payment ≥ outstanding → status paid, paymentReceivedAmount = amountTotal, paidAt stamped
 */
export async function recordInvoicePayment(
  invoiceId: string,
  _prev: InvoiceTransitionState,
  formData: FormData,
): Promise<InvoiceTransitionState> {
  const session = await getSession();
  try {
    requireCapability(session, 'invoice.send');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = RecordPaymentSchema.safeParse({
    amountDollars: formData.get('amountDollars'),
    paidOn: formData.get('paidOn') || undefined,
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid amount.' };
  const amountCents = Math.round(parsed.data.amountDollars * 100);
  const paidOn = parsed.data.paidOn ?? new Date();

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      number: true,
      status: true,
      amountTotal: true,
      paymentReceivedAmount: true,
      paidAt: true,
    },
  });
  if (!invoice) return { status: 'error', message: 'Invoice not found' };

  if (!['approved', 'sent', 'partial', 'overdue'].includes(invoice.status)) {
    return {
      status: 'error',
      message: `Can't record payment — invoice is ${invoice.status}.`,
    };
  }

  const alreadyPaid = invoice.paymentReceivedAmount ?? 0;
  const outstanding = invoice.amountTotal - alreadyPaid;
  if (outstanding <= 0) {
    return { status: 'error', message: 'Invoice is already fully paid.' };
  }
  if (amountCents > outstanding) {
    return {
      status: 'error',
      message: `Amount exceeds outstanding (${(outstanding / 100).toFixed(2)}).`,
    };
  }

  const nextReceived = alreadyPaid + amountCents;
  const fullyPaid = nextReceived >= invoice.amountTotal;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paymentReceivedAmount: nextReceived,
          status: fullyPaid ? 'paid' : 'partial',
          paidAt: fullyPaid ? paidOn : invoice.paidAt,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: fullyPaid ? 'marked_paid' : 'payment_recorded',
        entity: {
          type: 'invoice',
          id: invoiceId,
          before: {
            status: invoice.status,
            paymentReceivedAmount: alreadyPaid,
          },
          after: {
            status: fullyPaid ? 'paid' : 'partial',
            paymentReceivedAmount: nextReceived,
            paymentCents: amountCents,
            paidOn: paidOn.toISOString(),
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[invoice.recordPayment] failed:', err);
    return { status: 'error', message: 'Record failed — try again.' };
  }

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/ar');
  return {
    status: 'success',
    message: fullyPaid
      ? `${invoice.number} marked fully paid.`
      : `Recorded partial payment (${(amountCents / 100).toFixed(2)} AUD).`,
  };
}
