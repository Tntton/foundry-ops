import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';

const CONTRACTOR_PAYMENT_TERM_DAYS = 14;

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export type ContractorBillResult = {
  createdBillIds: string[];
  skipped: Array<{ personId: string; reason: string }>;
};

/**
 * Auto-generate contractor bills from an approved client invoice.
 *
 * Walks the timesheet entries linked to this invoice (via `billedInvoiceId`),
 * filters to contractors, groups by (person × project), and creates one Bill
 * per group at the contractor's cost rate (`Person.rate` — what they invoice
 * Foundry, distinct from `Person.billRate` which is what we charge the client).
 *
 * Bills are created in BillStatus.pending_review by default so the AP queue
 * still has a final manual gate before payment. Pass `skipApproval: true` to
 * mark them approved straight away — useful for low-friction contractor flows
 * where the underlying timesheet + client invoice approvals are deemed
 * sufficient.
 *
 * Returns the new bill ids and any skipped contractors (e.g. missing rate).
 *
 * NOTE on cost double-count: the project P&L already recognises timesheet
 * cost (hours × Person.rate) for entries with status `approved`/`billed`.
 * Once these auto-generated bills land in `approved`, the P&L roll-up will
 * count them again under bills. The agreed treatment for now is: keep both
 * legs, treat timesheet cost as accrual and bill cost as cash leg, and net
 * them out at month-end manually. Long-term fix tracked separately —
 * needs a schema flag like TimesheetEntry.excludedFromCost when a Bill
 * supersedes the entry's cost recognition.
 */
export async function generateContractorBillsFromInvoice(
  invoiceId: string,
  actorPersonId: string,
  options: { skipApproval?: boolean } = {},
): Promise<ContractorBillResult> {
  const skipApproval = options.skipApproval === true;

  const entries = await prisma.timesheetEntry.findMany({
    where: {
      billedInvoiceId: invoiceId,
      person: { employment: 'contractor' },
    },
    select: {
      id: true,
      hours: true,
      personId: true,
      projectId: true,
      person: {
        select: { firstName: true, lastName: true, rate: true },
      },
      project: { select: { code: true, name: true } },
    },
  });

  if (entries.length === 0) {
    return { createdBillIds: [], skipped: [] };
  }

  type Group = {
    personId: string;
    personFirstName: string;
    personLastName: string;
    rate: number;
    projectId: string;
    projectCode: string;
    projectName: string;
    hours: number;
    entryIds: string[];
  };
  const groups = new Map<string, Group>();
  for (const e of entries) {
    const key = `${e.personId}:${e.projectId}`;
    const cur =
      groups.get(key) ??
      ({
        personId: e.personId,
        personFirstName: e.person.firstName,
        personLastName: e.person.lastName,
        rate: e.person.rate ?? 0,
        projectId: e.projectId,
        projectCode: e.project.code,
        projectName: e.project.name,
        hours: 0,
        entryIds: [] as string[],
      } satisfies Group);
    cur.hours += Number(e.hours);
    cur.entryIds.push(e.id);
    groups.set(key, cur);
  }

  // De-dupe: don't create another Bill for a (person, invoice) pair that
  // already has one auto-linked (a previous run / manual draft-bill).
  const existingAuto = await prisma.auditEvent.findMany({
    where: {
      action: 'created',
      entityType: 'bill',
      entityDelta: {
        path: ['after', 'sourceInvoiceId'],
        equals: invoiceId,
      },
    },
    select: { entityId: true, entityDelta: true },
  });
  const alreadyBilledKeys = new Set<string>();
  for (const a of existingAuto) {
    const after = (a.entityDelta as { after?: Record<string, unknown> } | null)?.after;
    const personId = typeof after?.['personId'] === 'string' ? (after['personId'] as string) : null;
    const projectId =
      typeof after?.['projectId'] === 'string' ? (after['projectId'] as string) : null;
    if (personId && projectId) alreadyBilledKeys.add(`${personId}:${projectId}`);
  }

  const createdBillIds: string[] = [];
  const skipped: Array<{ personId: string; reason: string }> = [];

  await prisma.$transaction(async (tx) => {
    for (const [key, g] of groups) {
      if (alreadyBilledKeys.has(key)) {
        skipped.push({ personId: g.personId, reason: 'bill already exists for this invoice' });
        continue;
      }
      if (g.rate === 0) {
        skipped.push({ personId: g.personId, reason: 'no Person.rate set' });
        continue;
      }
      const exGstCents = Math.round(g.hours * g.rate);
      const gstCents = Math.round(exGstCents * 0.1);
      const totalCents = exGstCents + gstCents;
      const issueDate = new Date();
      const dueDate = addDays(issueDate, CONTRACTOR_PAYMENT_TERM_DAYS);

      const bill = await tx.bill.create({
        data: {
          supplierPersonId: g.personId,
          supplierName: `${g.personFirstName} ${g.personLastName}`,
          receivedVia: 'auto_from_approved_invoice',
          issueDate,
          dueDate,
          amountTotal: totalCents,
          gst: gstCents,
          category: 'Contractor — services',
          projectId: g.projectId,
          status: skipApproval ? 'approved' : 'pending_review',
        },
      });
      createdBillIds.push(bill.id);

      await writeAudit(tx, {
        actor: { type: 'person', id: actorPersonId },
        action: 'created',
        entity: {
          type: 'bill',
          id: bill.id,
          after: {
            source: 'auto_from_approved_invoice',
            sourceInvoiceId: invoiceId,
            personId: g.personId,
            projectId: g.projectId,
            projectCode: g.projectCode,
            hours: g.hours,
            rate: g.rate,
            exGstCents,
            gstCents,
            totalCents,
            timesheetEntryIds: g.entryIds,
            startInPayRunQueue: skipApproval,
          },
        },
        source: 'web',
      });
    }
  });

  return { createdBillIds, skipped };
}
