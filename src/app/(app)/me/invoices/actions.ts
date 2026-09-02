'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { addDays, daysInMonth, formatMonthLabel, monthStartFrom } from '@/lib/week';

const GST_RATE = 0.1;
const CONTRACTOR_PAYMENT_TERM_DAYS = 14;

const ConfirmSchema = z.object({
  personId: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  /**
   * Required. This is the contractor's OWN invoice number — the thing that
   * makes this their document rather than one Foundry issued for them (D1,
   * TT 2026-08-31). Leaving it optional would quietly turn the flow into a
   * recipient-created tax invoice, which needs a written agreement per
   * contractor that Foundry does not have.
   */
  contractorInvoiceNumber: z.string().trim().min(1).max(80),
  attachmentSharepointUrl: z
    .union([z.string().trim().url().max(500), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export type ConfirmInvoiceState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

/**
 * The contractor issues their invoice for a closed month.
 *
 * Foundry prepares the figures; the contractor checks them, supplies their
 * own invoice number, and submits. Only at that point does a Bill exist —
 * which is precisely what keeps this out of the RCTI regime.
 *
 * One Bill per project so each lands on that project's P&L, priced at the
 * rate FROZEN when the period closed (TASK-504) rather than whatever
 * Person.rate says today. Bills land in `pending_review`, so the AP queue
 * keeps its final human gate (A7).
 */
export async function confirmContractorInvoice(
  _prev: ConfirmInvoiceState,
  formData: FormData,
): Promise<ConfirmInvoiceState> {
  const session = await getSession();
  try {
    requireCapability(session, 'timesheet.submit');
  } catch {
    return { status: 'error', message: 'Not signed in' };
  }

  const parsed = ConfirmSchema.safeParse({
    personId: formData.get('personId'),
    year: formData.get('year'),
    month: formData.get('month'),
    contractorInvoiceNumber: formData.get('contractorInvoiceNumber'),
    attachmentSharepointUrl: formData.get('attachmentSharepointUrl') || null,
    notes: formData.get('notes') || null,
  });
  if (!parsed.success) {
    const missingNumber = parsed.error.issues.some(
      (i) => i.path[0] === 'contractorInvoiceNumber',
    );
    return {
      status: 'error',
      message: missingNumber
        ? 'Your invoice number is required — this is your invoice, issued by you.'
        : 'Invalid input',
    };
  }

  const { personId, year, month, contractorInvoiceNumber } = parsed.data;

  // Self-only, with an admin override for support cases. A contractor can
  // never issue an invoice in someone else's name.
  const isAdmin = hasAnyRole(session, ['super_admin', 'admin']);
  if (personId !== session!.person.id && !isAdmin) {
    return { status: 'error', message: 'You can only submit your own invoice.' };
  }

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, firstName: true, lastName: true, employment: true, endDate: true },
  });
  if (!person) return { status: 'error', message: 'Person not found' };
  if (person.employment !== 'contractor') {
    return {
      status: 'error',
      message: 'Only contractors invoice Foundry. Full-time staff are paid via pay runs.',
    };
  }

  const period = await prisma.timesheetPeriod.findUnique({
    where: { personId_year_month: { personId, year, month } },
  });
  const monthLabel = formatMonthLabel(monthStartFrom(year, month));
  if (!period) {
    return { status: 'error', message: `No lodged ${monthLabel} to invoice.` };
  }
  if (period.state === 'invoiced') {
    return { status: 'error', message: `${monthLabel} has already been invoiced.` };
  }
  if (period.state !== 'approved') {
    return {
      status: 'error',
      message: `${monthLabel} is ${period.state} — it can be invoiced once every project in it is approved.`,
    };
  }
  if (period.draftRateCents === null || period.draftRateCents <= 0) {
    return {
      status: 'error',
      message: 'No rate was recorded when this month closed — ask an admin to check your rate.',
    };
  }

  // Group the month's approved hours by project, priced at the SNAPSHOT rate.
  const start = monthStartFrom(year, month);
  const end = addDays(start, daysInMonth(year, month));
  const entries = await prisma.timesheetEntry.findMany({
    where: {
      personId,
      date: { gte: start, lt: end },
      status: 'approved',
      contractorBillId: null,
    },
    select: { id: true, projectId: true, hours: true, project: { select: { code: true } } },
  });
  if (entries.length === 0) {
    return {
      status: 'error',
      message: 'Every hour in this month is already on a contractor bill.',
    };
  }

  const rateCents = period.draftRateCents;
  const groups = new Map<
    string,
    { projectId: string; projectCode: string; hours: number; entryIds: string[] }
  >();
  for (const e of entries) {
    const cur = groups.get(e.projectId) ?? {
      projectId: e.projectId,
      projectCode: e.project.code,
      hours: 0,
      entryIds: [] as string[],
    };
    cur.hours += Number(e.hours);
    cur.entryIds.push(e.id);
    groups.set(e.projectId, cur);
  }

  const issueDate = new Date();
  const dueDate = addDays(issueDate, CONTRACTOR_PAYMENT_TERM_DAYS);
  const createdBillIds: string[] = [];
  let totalExGst = 0;

  try {
    await prisma.$transaction(async (tx) => {
      for (const g of groups.values()) {
        const exGstCents = Math.round(g.hours * rateCents);
        const gstCents = Math.round(exGstCents * GST_RATE);
        totalExGst += exGstCents;
        const bill = await tx.bill.create({
          data: {
            supplierPersonId: personId,
            supplierName: `${person.firstName} ${person.lastName}`,
            supplierInvoiceNumber: contractorInvoiceNumber,
            receivedVia: 'manual',
            attachmentSharepointUrl: parsed.data.attachmentSharepointUrl,
            issueDate,
            dueDate,
            amountTotal: exGstCents + gstCents,
            gst: gstCents,
            category: 'Contractor — services',
            projectId: g.projectId,
            status: 'pending_review',
          },
        });
        createdBillIds.push(bill.id);
        // AP leg only — never touches status or billedInvoiceId (TASK-500).
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
              source: 'contractor_period_invoice',
              periodYear: year,
              periodMonth: month,
              projectId: g.projectId,
              projectCode: g.projectCode,
              hours: g.hours,
              // The frozen rate, not today's — recorded so the audit trail
              // explains the amount even after a rate change.
              rateCentsAtClose: rateCents,
              exGstCents,
              gstCents,
              contractorInvoiceNumber,
              timesheetEntryIds: g.entryIds,
              issuedByContractor: true,
              onBehalfByAdmin: personId !== session!.person.id,
              notes: parsed.data.notes ?? null,
            },
          },
          source: 'web',
        });
      }

      await tx.timesheetPeriod.update({
        where: { id: period.id },
        data: {
          state: 'invoiced',
          invoicedAt: issueDate,
          contractorBillId: createdBillIds[0] ?? null,
        },
      });

      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'invoiced',
        entity: {
          type: 'timesheet_period',
          id: `${personId}:${year}-${String(month).padStart(2, '0')}`,
          before: { state: 'approved' },
          after: {
            state: 'invoiced',
            contractorInvoiceNumber,
            billIds: createdBillIds,
            rateCentsAtClose: rateCents,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[me.invoices.confirm] failed:', err);
    return { status: 'error', message: 'Submit failed — try again.' };
  }

  revalidatePath('/me/invoices');
  revalidatePath('/bills');
  revalidatePath('/timesheet');

  const gst = Math.round(totalExGst * GST_RATE);
  return {
    status: 'success',
    message:
      `Invoice ${contractorInvoiceNumber} submitted — $${((totalExGst + gst) / 100).toFixed(2)} ` +
      `inc GST across ${createdBillIds.length} ${createdBillIds.length === 1 ? 'project' : 'projects'}. ` +
      `It's with Foundry's AP review now.`,
  };
}
