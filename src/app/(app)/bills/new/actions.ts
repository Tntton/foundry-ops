'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import { resolveRequiredRole } from '@/server/approval-policies';
import { uploadReceiptToSharePoint } from '@/server/integrations/sharepoint-receipts';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// Bills + expenses share the canonical category list — both post into
// Xero as expense lines, both follow the same ATO deductibility splits.
// See src/lib/expense-categories.ts for the full set.
import { EXPENSE_CATEGORY_VALUES } from '@/lib/expense-categories';
const BILL_CATEGORIES = EXPENSE_CATEGORY_VALUES;

const BillCreateSchema = z
  .object({
    supplierName: z.string().trim().min(1).max(200),
    supplierPersonId: z.string().optional().nullable(),
    supplierInvoiceNumber: z.string().trim().max(80).optional().nullable(),
    issueDate: z.coerce.date(),
    dueDate: z.coerce.date(),
    amountDollars: z.coerce.number().min(0.01).max(10_000_000),
    gstDollars: z.coerce.number().min(0).max(10_000_000),
    category: z.enum(BILL_CATEGORIES),
    projectId: z.string().optional().nullable(),
    costCentre: z.string().trim().max(80).optional().nullable(),
    attachmentSharepointUrl: z
      .string()
      .trim()
      .url()
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
    intent: z.enum(['draft', 'submit']),
  })
  .refine((v) => v.gstDollars <= v.amountDollars, {
    message: 'GST cannot exceed total',
    path: ['gstDollars'],
  });

export type NewBillState = { status: 'idle' } | { status: 'error'; message: string };

export async function createBill(
  _prev: NewBillState,
  formData: FormData,
): Promise<NewBillState> {
  const session = await getSession();
  try {
    requireCapability(session, 'bill.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = BillCreateSchema.safeParse({
    supplierName: formData.get('supplierName'),
    supplierPersonId: formData.get('supplierPersonId') || null,
    supplierInvoiceNumber: formData.get('supplierInvoiceNumber') || null,
    issueDate: formData.get('issueDate'),
    dueDate: formData.get('dueDate'),
    amountDollars: formData.get('amountDollars'),
    gstDollars: formData.get('gstDollars'),
    category: formData.get('category'),
    projectId: formData.get('projectId') || null,
    costCentre: formData.get('costCentre') || null,
    attachmentSharepointUrl: formData.get('attachmentSharepointUrl') || null,
    intent: formData.get('intent'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid bill payload',
    };
  }
  const data = parsed.data;
  const amountCents = Math.round(data.amountDollars * 100);
  const gstCents = Math.round(data.gstDollars * 100);

  // Attachment upload takes precedence over the pasted-URL field —
  // if both are supplied, we archive the uploaded file to SharePoint
  // and ignore the URL (the URL was the pre-042b workaround). Upload
  // failure is soft: bill saves without an attachment link and audit
  // records the warning.
  let attachmentUrl: string | null = data.attachmentSharepointUrl ?? null;
  let attachmentDriveItemId: string | null = null;
  let uploadWarning: string | null = null;
  const attachmentFile = formData.get('attachment');
  if (attachmentFile instanceof File && attachmentFile.size > 0) {
    if (attachmentFile.size > MAX_ATTACHMENT_BYTES) {
      return {
        status: 'error',
        message: 'Attachment too large — max 20MB.',
      };
    }
    const mimeType = attachmentFile.type || 'application/octet-stream';
    if (!ALLOWED_ATTACHMENT_MIME.has(mimeType.toLowerCase())) {
      return {
        status: 'error',
        message: `Attachment format not accepted — use PDF, JPG, PNG, GIF, WEBP, or HEIC. Got ${mimeType}.`,
      };
    }
    try {
      const buffer = Buffer.from(await attachmentFile.arrayBuffer());
      const shortId = randomBytes(4).toString('hex');
      const upload = await uploadReceiptToSharePoint({
        kind: 'bill',
        date: data.issueDate,
        vendor: data.supplierName,
        amountCents,
        ownerInitials: session.person.initials,
        id: shortId,
        buffer,
        mimeType,
        originalFilename: attachmentFile.name,
      });
      if (upload) {
        attachmentUrl = upload.webUrl;
        attachmentDriveItemId = upload.driveItemId;
      } else {
        uploadWarning = 'SharePoint not configured — bill saved without an attachment link.';
      }
    } catch (err) {
      console.error('[bill.create] SharePoint upload failed:', err);
      uploadWarning = `SharePoint upload failed: ${(err as Error).message.slice(0, 120)}`;
    }
  }

  const nextStatus = data.intent === 'submit' ? 'pending_review' : 'pending_review';
  // MVP: 'draft' state isn't in BillStatus enum — intent=draft still saves as
  // pending_review but without an Approval row; intent=submit also creates the Approval.

  let newId: string;
  try {
    newId = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          supplierName: data.supplierName,
          supplierPersonId:
            data.supplierPersonId && data.supplierPersonId !== ''
              ? data.supplierPersonId
              : null,
          supplierInvoiceNumber: data.supplierInvoiceNumber,
          issueDate: data.issueDate,
          dueDate: data.dueDate,
          amountTotal: amountCents,
          gst: gstCents,
          category: data.category,
          projectId:
            data.projectId && data.projectId !== '' ? data.projectId : null,
          costCentre: data.costCentre,
          receivedVia: 'manual',
          status: nextStatus,
          attachmentSharepointUrl: attachmentUrl,
          attachmentDriveItemId,
        },
      });

      if (data.intent === 'submit') {
        const requiredRole = await resolveRequiredRole('bill', amountCents);
        const approval = await tx.approval.create({
          data: {
            subjectType: 'bill',
            subjectId: bill.id,
            requestedById: session.person.id,
            requiredRole,
            thresholdContext: { bill_amount_cents: amountCents },
            channel: 'web',
          },
          select: { id: true },
        });
        await notifyApproversOfNewApproval(tx, {
          approvalId: approval.id,
          subjectType: 'bill',
          subjectId: bill.id,
          requiredRole,
          requestedById: session.person.id,
          amountCents,
          summary: `${bill.supplierName ?? 'Vendor'} · $${(amountCents / 100).toFixed(0)}`,
        });
      }

      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: data.intent === 'submit' ? 'submitted' : 'created',
        entity: {
          type: 'bill',
          id: bill.id,
          after: {
            supplierName: bill.supplierName,
            amountTotal: amountCents,
            category: bill.category,
            projectId: bill.projectId,
            status: bill.status,
            attachmentDriveItemId,
            uploadWarning,
          },
        },
        source: 'web',
      });

      return bill.id;
    });
  } catch (err) {
    console.error('[bill.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/bills');
  revalidatePath('/approvals');
  redirect(`/bills/${newId}`);
}
