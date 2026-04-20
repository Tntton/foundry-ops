'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { resolveRequiredRole } from '@/server/approval-policies';

const BILL_CATEGORIES = [
  'subscriptions',
  'hosting',
  'office',
  'professional_services',
  'contractor_payment',
  'travel',
  'other',
] as const;

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
          attachmentSharepointUrl: data.attachmentSharepointUrl,
        },
      });

      if (data.intent === 'submit') {
        const requiredRole = await resolveRequiredRole('bill', amountCents);
        await tx.approval.create({
          data: {
            subjectType: 'bill',
            subjectId: bill.id,
            requestedById: session.person.id,
            requiredRole,
            thresholdContext: { bill_amount_cents: amountCents },
            channel: 'web',
          },
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
