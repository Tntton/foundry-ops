'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { resolveRequiredRole } from '@/server/approval-policies';
import { nextInvoiceNumber } from '@/server/invoices';

const LineSchema = z.object({
  label: z.string().trim().min(1).max(200),
  amountDollars: z.coerce.number().min(0).max(10_000_000),
});

const InvoiceCreateSchema = z
  .object({
    projectId: z.string().min(1),
    issueDate: z.coerce.date(),
    dueDate: z.coerce.date(),
    intent: z.enum(['draft', 'submit']),
    lines: z.array(LineSchema).min(1, 'At least one line item required'),
  })
  .refine((v) => v.dueDate.getTime() >= v.issueDate.getTime(), {
    message: 'Due date must be on or after issue date',
    path: ['dueDate'],
  });

export type NewInvoiceState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

export async function createInvoice(
  _prev: NewInvoiceState,
  formData: FormData,
): Promise<NewInvoiceState> {
  const session = await getSession();
  try {
    requireCapability(session, 'invoice.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const labels = formData.getAll('lineLabel').map(String);
  const amounts = formData.getAll('lineAmount').map(String);
  const lines = labels
    .map((label, i) => ({ label, amountDollars: amounts[i] ?? '0' }))
    .filter((l) => l.label.trim().length > 0);

  const parsed = InvoiceCreateSchema.safeParse({
    projectId: formData.get('projectId'),
    issueDate: formData.get('issueDate'),
    dueDate: formData.get('dueDate'),
    intent: formData.get('intent'),
    lines,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid invoice payload',
    };
  }
  const data = parsed.data;

  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { id: true, code: true, clientId: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  const amountExGstCents = data.lines.reduce(
    (s, l) => s + Math.round(l.amountDollars * 100),
    0,
  );
  const gstCents = Math.round(amountExGstCents * 0.1);
  const amountTotalCents = amountExGstCents + gstCents;
  const invoiceNumber = await nextInvoiceNumber(project.code);

  const nextStatus = data.intent === 'submit' ? 'pending_approval' : 'draft';

  let invoiceId: string;
  try {
    invoiceId = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          number: invoiceNumber,
          projectId: project.id,
          clientId: project.clientId,
          issueDate: data.issueDate,
          dueDate: data.dueDate,
          amountExGst: amountExGstCents,
          gst: gstCents,
          amountTotal: amountTotalCents,
          status: nextStatus,
          lineItems: {
            create: data.lines.map((l) => ({
              label: l.label,
              amount: Math.round(l.amountDollars * 100),
            })),
          },
        },
      });

      if (data.intent === 'submit') {
        const requiredRole = await resolveRequiredRole('invoice', amountTotalCents);
        await tx.approval.create({
          data: {
            subjectType: 'invoice',
            subjectId: invoice.id,
            requestedById: session.person.id,
            requiredRole,
            thresholdContext: {
              invoice_amount_cents: amountTotalCents,
              threshold_cents: 2_000_000,
            },
            channel: 'web',
          },
        });
      }

      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: data.intent === 'submit' ? 'submitted' : 'created',
        entity: {
          type: 'invoice',
          id: invoice.id,
          after: {
            number: invoice.number,
            amountTotal: amountTotalCents,
            status: nextStatus,
            projectId: project.id,
          },
        },
        source: 'web',
      });

      return invoice.id;
    });
  } catch (err) {
    console.error('[invoice.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/invoices');
  revalidatePath('/approvals');
  redirect(`/invoices/${invoiceId}`);
}
