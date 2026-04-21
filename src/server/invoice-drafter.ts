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
  };
}

/**
 * Create a draft invoice from approved timesheets. Links every billed
 * timesheet entry via billedInvoiceId so they won't get re-drafted. Returns
 * the new invoice id + code.
 */
export async function draftInvoiceFromTimesheets(
  session: Session,
  projectId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const preview = await previewInvoiceFromTimesheets(projectId, periodStart, periodEnd);
  if (preview.perPerson.length === 0) {
    throw new Error('No billable timesheet entries in that period.');
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { code: true, clientId: true },
  });

  const invoiceNumber = await nextInvoiceNumber(project.code);
  const today = new Date();
  const dueDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const amountExGst = preview.totalAmountCents;
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
        },
      },
      source: 'web',
    });
    return { invoiceId: invoice.id, invoiceNumber: invoice.number };
  });
  return result;
}
