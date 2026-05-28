import { prisma } from '@/server/db';
import { nextInvoiceNumber } from '@/server/invoices';
import { writeAudit } from '@/server/audit';
import type { Session } from '@/server/roles';

export type DraftableEntry = {
  personId: string;
  personInitials: string;
  personFirstName: string;
  personLastName: string;
  hours: number;
  billRateCents: number | null; // person.billRate if set, else falls back to rate (cost)
  lineAmountCents: number; // hours × billRate
  entryIds: string[];
};

export type DraftPreview = {
  projectId: string;
  projectCode: string;
  projectName: string;
  clientId: string;
  periodStart: Date;
  periodEnd: Date;
  perPerson: DraftableEntry[];
  totalHours: number;
  totalAmountCents: number;
  unbillableHours: number; // hours from people with no billRate on file
  unbillableEntryIds: string[];
  rebillableCosts: RebillableCost[];
  rebillableTotalExGstCents: number;
};

/**
 * A cost (vendor bill or personal expense) marked rebillable on the
 * project but not yet forwarded to a client invoice. Surfaced in the
 * draft-invoice flow as candidate pass-through line items.
 *
 * `kind` distinguishes the source so the drafter can stamp
 * `rebilledOnInvoiceId` on the right model and so the UI can label the
 * line clearly. Net (ex-GST) amount is what flows onto the invoice — GST
 * is recalculated at the invoice level.
 */
export type RebillableCost = {
  kind: 'bill' | 'expense';
  id: string;
  date: Date;
  /** Supplier (bill) or vendor/description (expense). */
  label: string;
  category: string;
  amountTotalCents: number;
  gstCents: number;
  amountExGstCents: number;
};

/**
 * Gather approved-and-unbilled timesheet entries for a project in a period,
 * grouped by person with their bill rate applied. Used by both the preview
 * page and the create action.
 */
export async function previewInvoiceFromTimesheets(
  projectId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<DraftPreview> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      code: true,
      name: true,
      clientId: true,
    },
  });

  const entries = await prisma.timesheetEntry.findMany({
    where: {
      projectId,
      status: 'approved',
      billedInvoiceId: null,
      date: { gte: periodStart, lt: periodEnd },
    },
    select: {
      id: true,
      hours: true,
      personId: true,
      person: {
        select: {
          id: true,
          initials: true,
          headshotUrl: true,
          firstName: true,
          lastName: true,
          billRate: true,
          rate: true,
        },
      },
    },
  });

  type Bucket = DraftableEntry;
  const byPerson = new Map<string, Bucket>();
  const unbillableEntryIds: string[] = [];
  let unbillableHours = 0;

  for (const e of entries) {
    const hours = Number(e.hours);
    const bill = e.person.billRate; // null when not set — person is non-billable at this point
    if (bill === null) {
      unbillableEntryIds.push(e.id);
      unbillableHours += hours;
      continue;
    }
    const row =
      byPerson.get(e.personId) ??
      ({
        personId: e.personId,
        personInitials: e.person.initials,
        personFirstName: e.person.firstName,
        personLastName: e.person.lastName,
        hours: 0,
        billRateCents: bill,
        lineAmountCents: 0,
        entryIds: [],
      } as Bucket);
    row.hours += hours;
    row.entryIds.push(e.id);
    row.lineAmountCents = Math.round(row.hours * bill);
    byPerson.set(e.personId, row);
  }

  const perPerson = [...byPerson.values()].sort(
    (a, b) => b.lineAmountCents - a.lineAmountCents,
  );
  const totalHours = perPerson.reduce((s, p) => s + p.hours, 0);
  const totalAmountCents = perPerson.reduce((s, p) => s + p.lineAmountCents, 0);

  const rebillableCosts = await listRebillableCostsForProject(project.id);
  const rebillableTotalExGstCents = rebillableCosts.reduce(
    (s, c) => s + c.amountExGstCents,
    0,
  );

  return {
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    clientId: project.clientId,
    periodStart,
    periodEnd,
    perPerson,
    totalHours,
    totalAmountCents,
    unbillableHours,
    unbillableEntryIds,
    rebillableCosts,
    rebillableTotalExGstCents,
  };
}

/**
 * List Bills + Expenses on a project that are marked `rebillable=true`
 * and haven't been forwarded yet (`rebilledOnInvoiceId IS NULL`). Bills
 * are filtered to status approved-or-later (no point billing the client
 * for a cost that hasn't even cleared internal review). Expenses are
 * filtered the same way (approved / batched_for_payment / reimbursed).
 *
 * Result is sorted oldest-first so longer-outstanding pass-throughs land
 * on the next invoice ahead of fresher ones.
 */
export async function listRebillableCostsForProject(
  projectId: string,
): Promise<RebillableCost[]> {
  const bills = await prisma.bill.findMany({
    where: {
      projectId,
      rebillable: true,
      rebilledOnInvoiceId: null,
      status: { in: ['approved', 'scheduled_for_payment', 'paid'] },
    },
    select: {
      id: true,
      issueDate: true,
      supplierName: true,
      supplierInvoiceNumber: true,
      category: true,
      amountTotal: true,
      gst: true,
    },
  });
  const expenses = await prisma.expense.findMany({
    where: {
      projectId,
      rebillable: true,
      rebilledOnInvoiceId: null,
      status: { in: ['approved', 'batched_for_payment', 'reimbursed'] },
    },
    select: {
      id: true,
      date: true,
      vendor: true,
      description: true,
      category: true,
      amount: true,
      gst: true,
      person: { select: { firstName: true, lastName: true } },
    },
  });
  const billRows: RebillableCost[] = bills.map((b) => ({
    kind: 'bill',
    id: b.id,
    date: b.issueDate,
    label: `${b.supplierName ?? 'Vendor bill'}${
      b.supplierInvoiceNumber ? ` · ${b.supplierInvoiceNumber}` : ''
    }`,
    category: b.category,
    amountTotalCents: b.amountTotal,
    gstCents: b.gst,
    amountExGstCents: b.amountTotal - b.gst,
  }));
  const expenseRows: RebillableCost[] = expenses.map((e) => ({
    kind: 'expense',
    id: e.id,
    date: e.date,
    label: `${e.vendor ?? e.description ?? 'Expense'} · ${e.person.firstName} ${e.person.lastName}`,
    category: e.category,
    amountTotalCents: e.amount,
    gstCents: e.gst,
    amountExGstCents: e.amount - e.gst,
  }));
  return [...billRows, ...expenseRows].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
}

/**
 * Create a draft invoice from approved timesheets. Links every billed
 * timesheet entry via billedInvoiceId so they won't get re-drafted.
 *
 * `rebillableBillIds` / `rebillableExpenseIds` (optional) — IDs from the
 * project's pending pass-through costs to forward onto this invoice as
 * line items. Each gets stamped with `rebilledOnInvoiceId` so it can't be
 * billed twice. Net (ex-GST) goes onto the line; the invoice's GST is
 * recalculated as 10% of the new total ex-GST.
 */
export async function draftInvoiceFromTimesheets(
  session: Session,
  projectId: string,
  periodStart: Date,
  periodEnd: Date,
  rebillableBillIds: string[] = [],
  rebillableExpenseIds: string[] = [],
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const preview = await previewInvoiceFromTimesheets(projectId, periodStart, periodEnd);
  const wantsTime = preview.perPerson.length > 0;
  const wantsCosts =
    rebillableBillIds.length > 0 || rebillableExpenseIds.length > 0;
  if (!wantsTime && !wantsCosts) {
    throw new Error('No billable hours or rebillable costs to draft from.');
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { code: true, clientId: true },
  });

  // Resolve & validate the picked rebillable costs — they have to belong
  // to this project, be flagged rebillable, and not already forwarded.
  const billsToBill =
    rebillableBillIds.length > 0
      ? await prisma.bill.findMany({
          where: {
            id: { in: rebillableBillIds },
            projectId,
            rebillable: true,
            rebilledOnInvoiceId: null,
          },
          select: {
            id: true,
            supplierName: true,
            supplierInvoiceNumber: true,
            issueDate: true,
            category: true,
            amountTotal: true,
            gst: true,
          },
        })
      : [];
  const expensesToBill =
    rebillableExpenseIds.length > 0
      ? await prisma.expense.findMany({
          where: {
            id: { in: rebillableExpenseIds },
            projectId,
            rebillable: true,
            rebilledOnInvoiceId: null,
          },
          select: {
            id: true,
            date: true,
            vendor: true,
            description: true,
            category: true,
            amount: true,
            gst: true,
            person: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
  if (billsToBill.length !== rebillableBillIds.length) {
    throw new Error(
      'Some rebillable bills are no longer eligible — refresh and try again.',
    );
  }
  if (expensesToBill.length !== rebillableExpenseIds.length) {
    throw new Error(
      'Some rebillable expenses are no longer eligible — refresh and try again.',
    );
  }
  const rebillableExGst =
    billsToBill.reduce((s, b) => s + (b.amountTotal - b.gst), 0) +
    expensesToBill.reduce((s, e) => s + (e.amount - e.gst), 0);

  const invoiceNumber = await nextInvoiceNumber(project.code);
  const today = new Date();
  const dueDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const amountExGst = preview.totalAmountCents + rebillableExGst;
  const gst = Math.round(amountExGst * 0.1);
  const amountTotal = amountExGst + gst;

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        number: invoiceNumber,
        projectId,
        clientId: project.clientId,
        issueDate: today,
        dueDate,
        amountExGst,
        gst,
        amountTotal,
        status: 'draft',
      },
    });
    for (const row of preview.perPerson) {
      const rangeLabel = `${preview.periodStart.toISOString().slice(0, 10)} → ${preview.periodEnd
        .toISOString()
        .slice(0, 10)}`;
      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          label: `${row.personFirstName} ${row.personLastName} · ${row.hours.toFixed(1)} hrs @ $${(
            (row.billRateCents ?? 0) / 100
          ).toFixed(2)}/h · ${rangeLabel}`,
          hours: row.hours,
          rate: row.billRateCents,
          amount: row.lineAmountCents,
          timesheetEntryIds: row.entryIds,
        },
      });
      await tx.timesheetEntry.updateMany({
        where: { id: { in: row.entryIds } },
        data: { billedInvoiceId: invoice.id },
      });
    }
    // Pass-through bill lines.
    for (const b of billsToBill) {
      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          label: `Pass-through · ${b.supplierName ?? 'Vendor'} ${
            b.supplierInvoiceNumber ? `(${b.supplierInvoiceNumber}) ` : ''
          }· ${b.category}`,
          amount: b.amountTotal - b.gst,
        },
      });
      await tx.bill.update({
        where: { id: b.id },
        data: { rebilledOnInvoiceId: invoice.id },
      });
    }
    // Pass-through expense lines.
    for (const e of expensesToBill) {
      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          label: `Pass-through · ${e.vendor ?? e.description ?? 'Expense'} · ${e.person.firstName} ${e.person.lastName} · ${e.category}`,
          amount: e.amount - e.gst,
        },
      });
      await tx.expense.update({
        where: { id: e.id },
        data: { rebilledOnInvoiceId: invoice.id },
      });
    }
    await writeAudit(tx, {
      actor: { type: 'person', id: session.person.id },
      action: 'drafted_from_timesheets',
      entity: {
        type: 'invoice',
        id: invoice.id,
        after: {
          number: invoice.number,
          projectId,
          people: preview.perPerson.length,
          hours: preview.totalHours,
          amountExGst,
          periodStart: preview.periodStart.toISOString(),
          periodEnd: preview.periodEnd.toISOString(),
          rebillableBillIds,
          rebillableExpenseIds,
          rebillableExGstCents: rebillableExGst,
        },
      },
      source: 'web',
    });
    return { invoiceId: invoice.id, invoiceNumber: invoice.number };
  });
  return result;
}

export type DraftableMilestone = {
  id: string;
  label: string;
  dueDate: Date;
  amountCents: number;
  status: string;
};

export type MilestonePreview = {
  projectId: string;
  projectCode: string;
  projectName: string;
  clientId: string;
  available: DraftableMilestone[];
  alreadyInvoiced: DraftableMilestone[];
  rebillableCosts: RebillableCost[];
};

/**
 * Preview milestones for a project — splits into available (not yet on an
 * invoice) and already-invoiced. The UI uses this to render the picker.
 */
export async function previewMilestonesForInvoice(
  projectId: string,
): Promise<MilestonePreview> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, code: true, name: true, clientId: true },
  });
  const milestones = await prisma.milestone.findMany({
    where: { projectId },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      label: true,
      dueDate: true,
      amount: true,
      status: true,
      invoiceId: true,
    },
  });
  const available: DraftableMilestone[] = [];
  const alreadyInvoiced: DraftableMilestone[] = [];
  for (const m of milestones) {
    const row: DraftableMilestone = {
      id: m.id,
      label: m.label,
      dueDate: m.dueDate,
      amountCents: m.amount,
      status: m.status,
    };
    if (m.invoiceId) alreadyInvoiced.push(row);
    else available.push(row);
  }
  const rebillableCosts = await listRebillableCostsForProject(project.id);
  return {
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    clientId: project.clientId,
    available,
    alreadyInvoiced,
    rebillableCosts,
  };
}

/**
 * Draft an invoice from a set of milestone ids. Each milestone becomes one
 * invoice line and gets its invoiceId stamped + status flipped to 'invoiced'.
 * Invoice number / dates / GST same logic as the timesheet drafter.
 *
 * Optional `rebillableBillIds` / `rebillableExpenseIds` get appended as
 * pass-through lines (same shape as the timesheet drafter) and stamped
 * `rebilledOnInvoiceId` so they leave the rebillable float.
 */
export async function draftInvoiceFromMilestones(
  session: Session,
  projectId: string,
  milestoneIds: string[],
  rebillableBillIds: string[] = [],
  rebillableExpenseIds: string[] = [],
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  if (
    milestoneIds.length === 0 &&
    rebillableBillIds.length === 0 &&
    rebillableExpenseIds.length === 0
  ) {
    throw new Error('Pick at least one milestone or pass-through cost.');
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { code: true, clientId: true },
  });

  const milestones =
    milestoneIds.length > 0
      ? await prisma.milestone.findMany({
          where: { id: { in: milestoneIds }, projectId },
        })
      : [];
  if (milestones.length !== milestoneIds.length) {
    throw new Error('Some milestones are not on this project.');
  }
  const alreadyInvoiced = milestones.filter((m) => m.invoiceId !== null);
  if (alreadyInvoiced.length > 0) {
    throw new Error(
      `Already invoiced: ${alreadyInvoiced.map((m) => m.label).join(', ')}. Refresh and try again.`,
    );
  }

  const billsToBill =
    rebillableBillIds.length > 0
      ? await prisma.bill.findMany({
          where: {
            id: { in: rebillableBillIds },
            projectId,
            rebillable: true,
            rebilledOnInvoiceId: null,
          },
          select: {
            id: true,
            supplierName: true,
            supplierInvoiceNumber: true,
            category: true,
            amountTotal: true,
            gst: true,
          },
        })
      : [];
  const expensesToBill =
    rebillableExpenseIds.length > 0
      ? await prisma.expense.findMany({
          where: {
            id: { in: rebillableExpenseIds },
            projectId,
            rebillable: true,
            rebilledOnInvoiceId: null,
          },
          select: {
            id: true,
            vendor: true,
            description: true,
            category: true,
            amount: true,
            gst: true,
            person: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
  if (billsToBill.length !== rebillableBillIds.length) {
    throw new Error(
      'Some rebillable bills are no longer eligible — refresh and try again.',
    );
  }
  if (expensesToBill.length !== rebillableExpenseIds.length) {
    throw new Error(
      'Some rebillable expenses are no longer eligible — refresh and try again.',
    );
  }

  const milestoneExGst = milestones.reduce((s, m) => s + m.amount, 0);
  const rebillableExGst =
    billsToBill.reduce((s, b) => s + (b.amountTotal - b.gst), 0) +
    expensesToBill.reduce((s, e) => s + (e.amount - e.gst), 0);

  const invoiceNumber = await nextInvoiceNumber(project.code);
  const today = new Date();
  const dueDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const amountExGst = milestoneExGst + rebillableExGst;
  const gst = Math.round(amountExGst * 0.1);
  const amountTotal = amountExGst + gst;

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        number: invoiceNumber,
        projectId,
        clientId: project.clientId,
        issueDate: today,
        dueDate,
        amountExGst,
        gst,
        amountTotal,
        status: 'draft',
      },
    });
    for (const m of milestones) {
      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          label: `Milestone: ${m.label}`,
          amount: m.amount,
        },
      });
      await tx.milestone.update({
        where: { id: m.id },
        data: { invoiceId: invoice.id, status: 'invoiced' },
      });
    }
    for (const b of billsToBill) {
      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          label: `Pass-through · ${b.supplierName ?? 'Vendor'} ${
            b.supplierInvoiceNumber ? `(${b.supplierInvoiceNumber}) ` : ''
          }· ${b.category}`,
          amount: b.amountTotal - b.gst,
        },
      });
      await tx.bill.update({
        where: { id: b.id },
        data: { rebilledOnInvoiceId: invoice.id },
      });
    }
    for (const e of expensesToBill) {
      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          label: `Pass-through · ${e.vendor ?? e.description ?? 'Expense'} · ${e.person.firstName} ${e.person.lastName} · ${e.category}`,
          amount: e.amount - e.gst,
        },
      });
      await tx.expense.update({
        where: { id: e.id },
        data: { rebilledOnInvoiceId: invoice.id },
      });
    }
    await writeAudit(tx, {
      actor: { type: 'person', id: session.person.id },
      action: 'drafted_from_milestones',
      entity: {
        type: 'invoice',
        id: invoice.id,
        after: {
          number: invoice.number,
          projectId,
          milestoneIds,
          amountExGst,
          rebillableBillIds,
          rebillableExpenseIds,
          rebillableExGstCents: rebillableExGst,
        },
      },
      source: 'web',
    });
    return { invoiceId: invoice.id, invoiceNumber: invoice.number };
  });
  return result;
}
