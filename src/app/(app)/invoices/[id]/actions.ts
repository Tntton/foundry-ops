'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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
