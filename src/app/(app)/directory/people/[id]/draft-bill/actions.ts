'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { markPeriodsInvoicedIfFullyBilled, monthKeysFor } from '@/server/timesheet';

export type DraftBillState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

const DraftBillSchema = z.object({
  contractorInvoiceNumber: z.string().trim().max(80).optional().nullable(),
  // The field is optional in the UI, and the caller normalises a blank
  // input to `null` (`formData.get(...) || null`). The previous shape —
  // `.optional().or(z.literal(''))` — accepted undefined and '' but NOT
  // null, so every submission without an attachment URL failed the parse
  // with "Invalid bill payload". Found by the TASK-500 tests; pre-existing.
  attachmentSharepointUrl: z
    .union([z.string().trim().url().max(500), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
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

  // Must mirror listContractorBillableEntries exactly, or the preview the
  // reviewer approved and the set this action bills diverge. Gated on the AP
  // leg (`contractorBillId`) — whether the CLIENT has been invoiced for the
  // hour is irrelevant to whether the contractor has been paid for it
  // (TASK-500; this used to read `billedInvoiceId: null`, which meant
  // invoicing a client silently withheld the contractor's own hours).
  const entries = await prisma.timesheetEntry.findMany({
    where: { personId, status: 'approved', contractorBillId: null },
    select: {
      id: true,
      date: true,
      projectId: true,
      hours: true,
      project: { select: { code: true, name: true } },
    },
  });
  if (entries.length === 0) {
    return {
      status: 'error',
      message: 'No approved hours left to invoice — they are all on a contractor bill already.',
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
        // Link the entries to this bill so they stop appearing on subsequent
        // draft-bill runs. This is the AP leg ONLY — it must not touch
        // `status`, and must not touch `billedInvoiceId`. Until TASK-500 this
        // set status='billed', which silently and permanently removed the
        // hours from the client-invoice pool (previewInvoiceFromTimesheets
        // filters status='approved'). A contractor hour is normally billed on
        // both legs: to the client at Person.billRate, and by the contractor
        // to Foundry at Person.rate.
        await tx.timesheetEntry.updateMany({
          where: { id: { in: g.entryIds } },
          data: { contractorBillId: bill.id },
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: session!.person.id },
          action: 'created',
          entity: {
            type: 'bill',
            id: bill.id,
            after: {
              source: 'timesheet_draft_bill',
              outOfCycle: true,
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

      // This path bills by person, not by period, so a month can end up
      // fully billed while its TimesheetPeriod still says `approved` —
      // which would leave the contractor staring at an invoice prompt for
      // hours already on a bill. Close any month this run completed, so
      // both routes leave the same state behind (TASK-505).
      await markPeriodsInvoicedIfFullyBilled(
        tx,
        personId,
        monthKeysFor(entries.map((e) => e.date)),
        issueDate,
      );
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
