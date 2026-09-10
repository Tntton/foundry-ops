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

  const rateCents = period.draftRateCents;
  const groups = new Map<
    string,
    {
      projectId: string;
      projectCode: string;
      hours: number;
      entryIds: string[];
      /** Pass-through costs, GST-INCLUSIVE (D3). */
      expenseTotalCents: number;
      /** GST contained within expenseTotalCents, which Foundry reclaims. */
      expenseGstCents: number;
      expenseIds: string[];
    }
  >();
  const emptyGroup = (projectId: string, projectCode: string) => ({
    projectId,
    projectCode,
    hours: 0,
    entryIds: [] as string[],
    expenseTotalCents: 0,
    expenseGstCents: 0,
    expenseIds: [] as string[],
  });
  for (const e of entries) {
    const cur = groups.get(e.projectId) ?? emptyGroup(e.projectId, e.project.code);
    cur.hours += Number(e.hours);
    cur.entryIds.push(e.id);
    groups.set(e.projectId, cur);
  }

  // Pass-through expenses for the same month (TASK-509). Mirrors the filter
  // in prepareContractorInvoiceDraft exactly — if the two drift, the
  // contractor confirms one set of figures and gets billed for another.
  // Untagged (OPEX) expenses are excluded: confirm raises one Bill per
  // project, so they have nowhere to land, and they stay on the
  // reimbursement path.
  const expenses = await prisma.expense.findMany({
    where: {
      personId,
      date: { gte: start, lt: end },
      status: 'approved',
      contractorBillId: null,
      projectId: { not: null },
    },
    select: {
      id: true,
      amount: true,
      gst: true,
      projectId: true,
      project: { select: { code: true } },
    },
  });
  for (const x of expenses) {
    const projectId = x.projectId!;
    const cur = groups.get(projectId) ?? emptyGroup(projectId, x.project?.code ?? '—');
    cur.expenseTotalCents += x.amount;
    cur.expenseGstCents += x.gst;
    cur.expenseIds.push(x.id);
    groups.set(projectId, cur);
  }

  if (groups.size === 0) {
    return {
      status: 'error',
      message:
        'Nothing left to invoice for this month — the hours and any expenses are already on a contractor bill.',
    };
  }

  const issueDate = new Date();
  const dueDate = addDays(issueDate, CONTRACTOR_PAYMENT_TERM_DAYS);
  const createdBillIds: string[] = [];
  let totalExGst = 0;

  try {
    await prisma.$transaction(async (tx) => {
      for (const g of groups.values()) {
        // Fees: GST is ADDED to hours × rate (the contractor's own supply).
        const feesExGstCents = Math.round(g.hours * rateCents);
        const feesGstCents = Math.round(feesExGstCents * GST_RATE);
        // Expenses: passed through at what the contractor paid, GST already
        // inside the figure and NOT charged again on top (D3,
        // TT 2026-09-10). Foundry reclaims that GST as an input credit.
        const gstCents = feesGstCents + g.expenseGstCents;
        const amountTotalCents = feesExGstCents + feesGstCents + g.expenseTotalCents;
        totalExGst += feesExGstCents;
        const bill = await tx.bill.create({
          data: {
            supplierPersonId: personId,
            supplierName: `${person.firstName} ${person.lastName}`,
            supplierInvoiceNumber: contractorInvoiceNumber,
            receivedVia: 'manual',
            attachmentSharepointUrl: parsed.data.attachmentSharepointUrl,
            issueDate,
            dueDate,
            amountTotal: amountTotalCents,
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
        // Same for the pass-through costs. Setting contractorBillId takes
        // them out of the reimbursement float, so they can't also be paid
        // through a pay run. `rebillable` / `rebilledOnInvoiceId` are left
        // alone: recharging the client is a separate, legitimate leg.
        if (g.expenseIds.length > 0) {
          await tx.expense.updateMany({
            where: { id: { in: g.expenseIds } },
            data: { contractorBillId: bill.id },
          });
        }
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
              expenseIds: g.expenseIds,
              expenseTotalCentsIncGst: g.expenseTotalCents,
              expenseGstCentsReclaimable: g.expenseGstCents,
              expenseTreatment: 'pass_through_contractor_adds_no_gst',
              // The frozen rate, not today's — recorded so the audit trail
              // explains the amount even after a rate change.
              rateCentsAtClose: rateCents,
              feesExGstCents,
              feesGstCents,
              gstCents,
              amountTotalCents,
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
