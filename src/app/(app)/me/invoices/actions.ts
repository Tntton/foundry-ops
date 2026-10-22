'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { addDays, daysInMonth, formatMonthLabel, monthStartFrom } from '@/lib/week';
import {
  markPeriodsInvoicedIfFullyBilled,
  monthsInRange,
} from '@/server/timesheet';
import { contractorInvoiceNumberTaken } from '@/server/contractor-bills';

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

// ─── Date-range invoice (TASK-511) ──────────────────────────────────────

const MAX_RANGE_DAYS = 400;

const RangeSchema = z
  .object({
    personId: z.string().min(1),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date is required'),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date is required'),
    contractorInvoiceNumber: z.string().trim().min(1).max(80),
    // D5: the contractor sets their own dates. Defaulted on the form to
    // today / today + 14, but neither is imposed — a contractor invoicing
    // late, or on 30-day terms of their own, must not have to ask.
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date is required'),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date is required'),
    /** D5: the contractor's own identifier — their PO, a client ref, an
     *  engagement nickname. Lands on `Bill.description` so AP and Xero can
     *  see it, rather than stopping in the audit trail the way `notes` does. */
    description: z.string().trim().max(500).optional().nullable(),
    attachmentSharepointUrl: z
      .union([z.string().trim().url().max(500), z.literal(''), z.null()])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((v) => v.end >= v.start, {
    message: 'The end date must be on or after the start date.',
    path: ['end'],
  })
  .refine((v) => v.dueDate >= v.issueDate, {
    message: 'The due date must be on or after the issue date.',
    path: ['dueDate'],
  });

/** Per-project fee override, posted as `fee:<projectId>` in dollars.
 *
 *  D5 makes every field editable, fee lines included — a contractor who
 *  agreed a discount, a rounding, or a capped month needs to say so on the
 *  invoice rather than raising the derived figure and arguing later. The
 *  DERIVED amount is always recorded beside the override in the audit event,
 *  so "why doesn't this match the hours" has an answer on the row.
 *
 *  Hours and their `contractorBillId` links are untouched by an override:
 *  the hours were still worked and are still consumed by this bill. Only
 *  the money moves. */
const FeeOverrideSchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/)
  .transform((v) => Math.round(Number(v) * 100));

function parseUtcDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/**
 * Raise a contractor invoice for an arbitrary date range.
 *
 * Sibling of `confirmContractorInvoice`, not a replacement: that one answers
 * "invoice September", this one answers "invoice 15 Sep – 14 Oct". They share
 * the invariant that matters — an hour is billable iff
 * `status = 'approved' AND contractorBillId IS NULL`, set inside the same
 * transaction that creates the Bill — so neither can bill an hour the other
 * already billed, whatever the windows do.
 *
 * Rates resolve PER ENTRY (frozen period rate where one exists, else the
 * contractor's current rate). A range spanning a closed month and an open
 * one must not reprice the closed part; see `resolveEntryRateCents`.
 *
 * Everything is recomputed here inside the transaction. Nothing the preview
 * rendered is trusted on the way back in.
 */
export async function generateRangeContractorInvoice(
  _prev: ConfirmInvoiceState,
  formData: FormData,
): Promise<ConfirmInvoiceState> {
  const session = await getSession();
  try {
    requireCapability(session, 'timesheet.submit');
  } catch {
    return { status: 'error', message: 'Not signed in' };
  }

  const parsed = RangeSchema.safeParse({
    personId: formData.get('personId'),
    start: formData.get('start'),
    end: formData.get('end'),
    contractorInvoiceNumber: formData.get('contractorInvoiceNumber'),
    issueDate: formData.get('issueDate'),
    dueDate: formData.get('dueDate'),
    description: formData.get('description') || null,
    attachmentSharepointUrl: formData.get('attachmentSharepointUrl') || null,
    notes: formData.get('notes') || null,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const missingNumber = parsed.error.issues.some(
      (i) => i.path[0] === 'contractorInvoiceNumber',
    );
    return {
      status: 'error',
      message: missingNumber
        ? 'Your invoice number is required — this is your invoice, issued by you.'
        : (issue?.message ?? 'Invalid input'),
    };
  }

  const { personId, contractorInvoiceNumber } = parsed.data;
  const start = parseUtcDate(parsed.data.start);
  const end = parseUtcDate(parsed.data.end);
  const endExclusive = addDays(end, 1);

  const spanDays = Math.round(
    (endExclusive.getTime() - start.getTime()) / 86_400_000,
  );
  if (spanDays > MAX_RANGE_DAYS) {
    return {
      status: 'error',
      message: `That range covers ${spanDays} days — invoice at most ${MAX_RANGE_DAYS} days at a time.`,
    };
  }

  // Self-only, with an admin override for support cases.
  const isAdmin = hasAnyRole(session, ['super_admin', 'admin']);
  if (personId !== session!.person.id && !isAdmin) {
    return { status: 'error', message: 'You can only submit your own invoice.' };
  }

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, firstName: true, lastName: true, employment: true, rate: true },
  });
  if (!person) return { status: 'error', message: 'Person not found' };
  if (person.employment !== 'contractor') {
    return {
      status: 'error',
      message: 'Only contractors invoice Foundry. Full-time staff are paid via pay runs.',
    };
  }

  const issueDate = parseUtcDate(parsed.data.issueDate);
  const dueDate = parseUtcDate(parsed.data.dueDate);
  const description = parsed.data.description?.trim() || null;

  // The number is a suggestion the contractor can edit (D1/D5), so an edited
  // one can collide — with an earlier invoice of theirs, or with the
  // suggestion if they raised one in another tab. Scoped to this person:
  // two different contractors both using `INV-001` is normal.
  if (await contractorInvoiceNumberTaken(personId, contractorInvoiceNumber)) {
    return {
      status: 'error',
      message: `You have already issued an invoice numbered ${contractorInvoiceNumber}. Change the number and submit again.`,
    };
  }

  // Per-project fee overrides, keyed `fee:<projectId>`. Parsed up front so a
  // malformed amount is rejected before anything is written.
  const feeOverrides = new Map<string, number>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('fee:') || typeof value !== 'string') continue;
    if (value.trim() === '') continue;
    const check = FeeOverrideSchema.safeParse(value);
    if (!check.success) {
      return {
        status: 'error',
        message: 'Fee amounts must be a number of dollars, e.g. 1250 or 1250.50.',
      };
    }
    feeOverrides.set(key.slice(4), check.data);
  }

  const createdBillIds: string[] = [];
  let totalIncGst = 0;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const currentRateCents = person.rate ?? 0;

      // Frozen rates for every month the window touches, read inside the
      // transaction so a concurrent period close can't land between the
      // preview and the write.
      const months = monthsInRange(start, endExclusive);
      const periods = await tx.timesheetPeriod.findMany({
        where: {
          personId,
          OR: months.map((m) => ({ year: m.year, month: m.month })),
        },
        select: { year: true, month: true, draftRateCents: true },
      });
      const frozenByMonth = new Map<string, number>();
      for (const p of periods) {
        if (p.draftRateCents !== null && p.draftRateCents > 0) {
          frozenByMonth.set(`${p.year}-${p.month}`, p.draftRateCents);
        }
      }

      const entries = await tx.timesheetEntry.findMany({
        where: {
          personId,
          date: { gte: start, lt: endExclusive },
          status: 'approved',
          contractorBillId: null,
        },
        select: {
          id: true,
          date: true,
          hours: true,
          projectId: true,
          project: { select: { code: true } },
        },
      });

      type RangeGroup = {
        projectId: string;
        projectCode: string;
        hours: number;
        feesExGstCents: number;
        entryIds: string[];
        expenseTotalCents: number;
        expenseGstCents: number;
        expenseIds: string[];
        /** rate → hours, for the audit trail. */
        rateBreakdown: Record<string, number>;
      };
      const emptyGroup = (projectId: string, projectCode: string): RangeGroup => ({
        projectId,
        projectCode,
        hours: 0,
        feesExGstCents: 0,
        entryIds: [],
        expenseTotalCents: 0,
        expenseGstCents: 0,
        expenseIds: [],
        rateBreakdown: {},
      });
      const groups = new Map<string, RangeGroup>();

      let unpricedHours = 0;
      for (const e of entries) {
        const hours = Number(e.hours);
        if (hours <= 0) continue;
        const key = `${e.date.getUTCFullYear()}-${e.date.getUTCMonth() + 1}`;
        const frozen = frozenByMonth.get(key);
        const rateCents =
          frozen !== undefined && frozen > 0 ? frozen : currentRateCents;
        if (rateCents <= 0) {
          unpricedHours += hours;
          continue;
        }
        const cur =
          groups.get(e.projectId) ?? emptyGroup(e.projectId, e.project.code);
        cur.hours += hours;
        cur.feesExGstCents += Math.round(hours * rateCents);
        cur.entryIds.push(e.id);
        cur.rateBreakdown[String(rateCents)] =
          (cur.rateBreakdown[String(rateCents)] ?? 0) + hours;
        groups.set(e.projectId, cur);
      }

      if (unpricedHours > 0) {
        return {
          error: `No rate on file for ${unpricedHours.toFixed(2)}h in this range — ask an admin to set your rate.`,
        } as const;
      }

      // Pass-through expenses on the TASK-509 terms: approved, unbilled,
      // project-tagged. Untagged OPEX has no Bill to land on and stays on
      // the reimbursement path.
      const expenses = await tx.expense.findMany({
        where: {
          personId,
          date: { gte: start, lt: endExclusive },
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
        const cur =
          groups.get(projectId) ?? emptyGroup(projectId, x.project?.code ?? '—');
        cur.expenseTotalCents += x.amount;
        cur.expenseGstCents += x.gst;
        cur.expenseIds.push(x.id);
        groups.set(projectId, cur);
      }

      if (groups.size === 0) {
        return {
          error:
            'Nothing to invoice in that range — the approved hours and expenses in it are already on a contractor bill.',
        } as const;
      }

      for (const g of groups.values()) {
        // D5: the fee line is editable. Where the contractor changed it the
        // override IS the invoice; the derived figure is kept for the audit
        // row so the difference is explainable rather than mysterious.
        const derivedFeesExGstCents = g.feesExGstCents;
        const override = feeOverrides.get(g.projectId);
        const feesExGstCents =
          override !== undefined ? override : derivedFeesExGstCents;
        const feeWasOverridden =
          override !== undefined && override !== derivedFeesExGstCents;

        // Fees: GST ADDED on top of the fee amount (the contractor's supply).
        const feesGstCents = Math.round(feesExGstCents * GST_RATE);
        // Expenses: GST already inside the figure, never charged again (D3).
        const gstCents = feesGstCents + g.expenseGstCents;
        const amountTotalCents =
          feesExGstCents + feesGstCents + g.expenseTotalCents;
        totalIncGst += amountTotalCents;

        const bill = await tx.bill.create({
          data: {
            supplierPersonId: personId,
            supplierName: `${person.firstName} ${person.lastName}`,
            supplierInvoiceNumber: contractorInvoiceNumber,
            receivedVia: 'manual',
            description,
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
        if (g.entryIds.length > 0) {
          await tx.timesheetEntry.updateMany({
            where: { id: { in: g.entryIds } },
            data: { contractorBillId: bill.id },
          });
        }
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
              source: 'contractor_range_invoice',
              rangeStart: parsed.data.start,
              rangeEnd: parsed.data.end,
              projectId: g.projectId,
              projectCode: g.projectCode,
              hours: g.hours,
              // Which rate priced which hours — the range can legitimately
              // mix a frozen period rate with the current one, so a single
              // "rate" field would misrepresent the amount.
              hoursByRateCents: g.rateBreakdown,
              feesExGstCents,
              // Present so an amount that doesn't reconcile to hours × rate
              // explains itself without anyone re-deriving it by hand.
              derivedFeesExGstCents,
              feeWasOverridden,
              feesGstCents,
              expenseIds: g.expenseIds,
              expenseTotalCentsIncGst: g.expenseTotalCents,
              expenseGstCentsReclaimable: g.expenseGstCents,
              expenseTreatment: 'pass_through_contractor_adds_no_gst',
              gstCents,
              amountTotalCents,
              contractorInvoiceNumber,
              invoiceDescription: description,
              issueDate: parsed.data.issueDate,
              dueDate: parsed.data.dueDate,
              timesheetEntryIds: g.entryIds,
              issuedByContractor: true,
              onBehalfByAdmin: personId !== session!.person.id,
              notes: parsed.data.notes ?? null,
            },
          },
          source: 'web',
        });
      }

      // A month the range fully consumed should close, not sit at `approved`
      // showing a phantom "ready to invoice" prompt for hours already billed.
      await markPeriodsInvoicedIfFullyBilled(tx, personId, months, issueDate);

      return { error: null } as const;
    });

    if (outcome.error) return { status: 'error', message: outcome.error };
  } catch (err) {
    console.error('[me.invoices.range] failed:', err);
    return { status: 'error', message: 'Submit failed — try again.' };
  }

  revalidatePath('/me/invoices');
  revalidatePath('/bills');
  revalidatePath('/timesheet');

  return {
    status: 'success',
    message:
      `Invoice ${contractorInvoiceNumber} submitted — $${(totalIncGst / 100).toFixed(2)} ` +
      `inc GST across ${createdBillIds.length} ${createdBillIds.length === 1 ? 'project' : 'projects'}. ` +
      `It's with Foundry's AP review now.`,
  };
}
