'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { renderInvoicePdfWithReceipts } from '@/server/invoice-pdf';
import {
  uploadInvoicePdfToSharePoint,
  type InvoiceUploadResult,
} from '@/server/integrations/sharepoint-receipts';

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
 * downloaded, and archive a copy to SharePoint (TASK-068). Called from
 * the preview page's "Download as PDF" click so the system can flag
 * approved-but-not-yet-issued invoices and keep an audit copy in 365.
 *
 * Idempotent on the finalisation timestamp — the first issuance time is
 * preserved. Archival is retried until it succeeds: if Graph was
 * unreachable on the first finalise (pointer still null), a later call
 * re-attempts the upload rather than short-circuiting.
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
      issueDate: true,
      amountTotal: true,
      taxInvoiceFinalisedAt: true,
      taxInvoiceSharepointUrl: true,
    },
  });
  if (!invoice) return { status: 'error', message: 'Invoice not found' };

  // Fully done — finalised AND archived. Subsequent downloads still
  // produce a PDF client-side but there's nothing left to persist.
  if (invoice.taxInvoiceFinalisedAt && invoice.taxInvoiceSharepointUrl) {
    return {
      status: 'success',
      finalisedAt: invoice.taxInvoiceFinalisedAt.toISOString(),
    };
  }

  // Preserve the original issuance time; only stamp it on first finalise.
  const finalisedAt = invoice.taxInvoiceFinalisedAt ?? new Date();

  // Render + upload the PDF to SharePoint. Best-effort: a Graph outage
  // (or Graph simply not configured) must not block finalisation — the
  // pointer stays null and the next finalise call retries. Any failure
  // here is logged and swallowed so the DB record still lands.
  let upload: InvoiceUploadResult | null = null;
  try {
    const pdf = await renderInvoicePdfWithReceipts(invoiceId);
    upload = await uploadInvoicePdfToSharePoint({
      issueDate: invoice.issueDate,
      invoiceNumber: invoice.number,
      amountTotalCents: invoice.amountTotal,
      ownerInitials: session.person.initials,
      id: invoiceId,
      buffer: Buffer.from(pdf),
    });
  } catch (err) {
    console.error('[invoice.finalise] SharePoint archival failed:', err);
    upload = null;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          taxInvoiceFinalisedAt: finalisedAt,
          ...(upload
            ? {
                taxInvoiceSharepointUrl: upload.webUrl,
                taxInvoiceDriveItemId: upload.driveItemId,
              }
            : {}),
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'invoice',
          id: invoiceId,
          after: {
            via: upload ? 'tax_invoice_archived' : 'tax_invoice_finalised',
            invoiceNumber: invoice.number,
            finalisedAt: finalisedAt.toISOString(),
            statusAtFinalise: invoice.status,
            ...(upload
              ? { sharepointUrl: upload.webUrl }
              : { archiveSkipped: true }),
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
