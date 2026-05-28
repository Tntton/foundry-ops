'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

export type PreviewSaveState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const Schema = z.object({
  invoiceId: z.string().min(1),
  purchaseOrderRef: z.string().trim().max(80).nullable(),
  forSubject: z.string().trim().max(120).nullable(),
  attentionTo: z.string().trim().max(120).nullable(),
  // Allow editing the primary line item description inline.
  primaryLineLabel: z.string().trim().max(2000).nullable(),
});

/**
 * Persist template-only edits made on the preview page. Limited to:
 *   - PO reference, "FOR" subject, Attention contact override
 *   - Primary line item label (the long-form description)
 *
 * Doesn't change financial totals or status — those flow through the
 * regular invoice edit / approval surfaces.
 */
export async function saveInvoicePreview(
  invoiceId: string,
  _prev: PreviewSaveState,
  formData: FormData,
): Promise<PreviewSaveState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };
  try {
    if (!hasCapability(session, 'invoice.create')) {
      return { status: 'error', message: 'Not authorized' };
    }
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = Schema.safeParse({
    invoiceId,
    purchaseOrderRef:
      ((formData.get('purchaseOrderRef') as string | null) ?? '').trim() ||
      null,
    forSubject:
      ((formData.get('forSubject') as string | null) ?? '').trim() || null,
    attentionTo:
      ((formData.get('attentionTo') as string | null) ?? '').trim() || null,
    primaryLineLabel:
      ((formData.get('primaryLineLabel') as string | null) ?? '').trim() ||
      null,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      number: true,
      status: true,
      lineItems: { select: { id: true }, orderBy: { id: 'asc' }, take: 1 },
    },
  });
  if (!invoice) return { status: 'error', message: 'Invoice not found' };
  if (
    invoice.status !== 'draft' &&
    invoice.status !== 'pending_approval'
  ) {
    return {
      status: 'error',
      message:
        'Template fields can only be edited on draft / pending invoices.',
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          purchaseOrderRef: parsed.data.purchaseOrderRef,
          forSubject: parsed.data.forSubject,
          attentionTo: parsed.data.attentionTo,
        },
      });
      // Update primary line item if present and a label was provided.
      const firstLine = invoice.lineItems[0];
      if (firstLine && parsed.data.primaryLineLabel) {
        await tx.invoiceLine.update({
          where: { id: firstLine.id },
          data: { label: parsed.data.primaryLineLabel },
        });
      }
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'invoice',
          id: invoiceId,
          after: {
            via: 'preview_template_edit',
            invoiceNumber: invoice.number,
            poRef: parsed.data.purchaseOrderRef,
            forSubject: parsed.data.forSubject,
            attentionTo: parsed.data.attentionTo,
            primaryLineLabel: parsed.data.primaryLineLabel,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[invoice.preview] save failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/invoices/${invoiceId}/preview`);
  return { status: 'success' };
}

export type FinaliseState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; finalisedAt: string };

/**
 * Record that the rendered tax invoice PDF has been generated &
 * downloaded. Called from the preview page's "Download as PDF" click
 * so the system can flag approved-but-not-yet-issued invoices.
 *
 * Idempotent — calling it twice keeps the original timestamp so the
 * audit trail reflects the first issuance time.
 */
export async function finaliseInvoice(
  invoiceId: string,
): Promise<FinaliseState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      number: true,
      status: true,
      taxInvoiceFinalisedAt: true,
    },
  });
  if (!invoice) return { status: 'error', message: 'Invoice not found' };

  // Only record finalisation once. Subsequent downloads still produce a
  // PDF but don't overwrite the original issuance timestamp.
  if (invoice.taxInvoiceFinalisedAt) {
    return {
      status: 'success',
      finalisedAt: invoice.taxInvoiceFinalisedAt.toISOString(),
    };
  }

  const finalisedAt = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { taxInvoiceFinalisedAt: finalisedAt },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'invoice',
          id: invoiceId,
          after: {
            via: 'tax_invoice_finalised',
            invoiceNumber: invoice.number,
            finalisedAt: finalisedAt.toISOString(),
            statusAtFinalise: invoice.status,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[invoice.finalise] failed:', err);
    return { status: 'error', message: 'Could not record finalisation.' };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/invoices/${invoiceId}/preview`);
  revalidatePath('/invoices');
  return { status: 'success', finalisedAt: finalisedAt.toISOString() };
}
