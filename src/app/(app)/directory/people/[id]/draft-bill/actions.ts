'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';

export type DraftBillState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

const DraftBillSchema = z.object({
  contractorInvoiceNumber: z.string().trim().max(80).optional().nullable(),
  attachmentSharepointUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => null)),
  issueDate: z.string().min(1),
  dueDate: z.string().min(1),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const GST_RATE = 0.1;

export async function generateDraftBillFromHours(
  personId: string,
  _prev: DraftBillState,
  formData: FormData,
): Promise<DraftBillState> {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = DraftBillSchema.safeParse({
    contractorInvoiceNumber: formData.get('contractorInvoiceNumber') || null,
    attachmentSharepointUrl: formData.get('attachmentSharepointUrl') || null,
    issueDate: formData.get('issueDate'),
    dueDate: formData.get('dueDate'),
    notes: formData.get('notes') || null,
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid bill payload' };

  const issueDate = new Date(`${parsed.data.issueDate}T00:00:00Z`);
  const dueDate = new Date(`${parsed.data.dueDate}T00:00:00Z`);
  if (
    Number.isNaN(issueDate.getTime()) ||
    Number.isNaN(dueDate.getTime()) ||
    dueDate.getTime() < issueDate.getTime()
  ) {
    return { status: 'error', message: 'Issue and due dates must be valid (due ≥ issue).' };
  }

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employment: true,
      rate: true,
      billRate: true,
    },
  });
  if (!person) return { status: 'error', message: 'Person not found' };
  if (person.employment !== 'contractor') {
    return {
      status: 'error',
      message: 'Draft bills are only generated for contractors. Full-time staff are paid via pay runs.',
    };
  }

  const entries = await prisma.timesheetEntry.findMany({
    where: { personId, status: 'approved', billedInvoiceId: null },
    select: { id: true, projectId: true, hours: true, project: { select: { code: true, name: true } } },
  });
  if (entries.length === 0) {
    return {
      status: 'error',
      message: 'No approved & unbilled hours to bill.',
    };
  }

  // Group entries per project — one Bill per project so each shows up
  // attributed to that project's P&L.
  const groupsMap = new Map<
    string,
    {
      projectId: string;
      projectCode: string;
      projectName: string;
      hours: number;
      entryIds: string[];
    }
  >();
  for (const e of entries) {
    const cur =
      groupsMap.get(e.projectId) ??
      {
        projectId: e.projectId,
        projectCode: e.project.code,
        projectName: e.project.name,
        hours: 0,
        entryIds: [] as string[],
      };
    cur.hours += Number(e.hours);
    cur.entryIds.push(e.id);
    groupsMap.set(e.projectId, cur);
  }
  const groups = Array.from(groupsMap.values());

  const billRate = person.billRate ?? person.rate ?? 0;
  if (billRate === 0) {
    return {
      status: 'error',
      message: "Person has no rate set — set their cost rate (or billRate) first.",
    };
  }

  const createdBillIds: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      for (const g of groups) {
        const exGstCents = Math.round(g.hours * billRate);
        const gstCents = Math.round(exGstCents * GST_RATE);
        const totalCents = exGstCents + gstCents;
        const bill = await tx.bill.create({
          data: {
            supplierPersonId: personId,
            supplierName: `${person.firstName} ${person.lastName}`,
            supplierInvoiceNumber: parsed.data.contractorInvoiceNumber ?? null,
            receivedVia: 'manual',
            attachmentSharepointUrl: parsed.data.attachmentSharepointUrl ?? null,
            issueDate,
            dueDate,
            amountTotal: totalCents,
            gst: gstCents,
            category: 'Contractor — services',
            projectId: g.projectId,
            status: 'pending_review',
          },
        });
        createdBillIds.push(bill.id);
        // Mark entries billed so they stop appearing on subsequent draft-bill runs.
        // We don't have a Bill→TimesheetEntry FK column, so the linkage lives in the
        // audit event below for traceability.
        await tx.timesheetEntry.updateMany({
          where: { id: { in: g.entryIds } },
          data: { status: 'billed' },
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: session!.person.id },
          action: 'created',
          entity: {
            type: 'bill',
            id: bill.id,
            after: {
              source: 'timesheet_draft_bill',
              projectId: g.projectId,
              projectCode: g.projectCode,
              hours: g.hours,
              billRate,
              exGstCents,
              gstCents,
              totalCents,
              timesheetEntryIds: g.entryIds,
              notes: parsed.data.notes ?? null,
            },
          },
          source: 'web',
        });
      }
    });
  } catch (err) {
    console.error('[bill.draftFromHours] failed:', err);
    return { status: 'error', message: 'Generate failed — try again.' };
  }

  revalidatePath(`/directory/people/${personId}`);
  revalidatePath('/bills');
  if (createdBillIds.length === 1) {
    redirect(`/bills/${createdBillIds[0]}`);
  }
  redirect(`/bills?from=drafted&count=${createdBillIds.length}`);
}
