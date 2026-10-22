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

// ─── Contractor invoice numbering (TASK-511, D5) ────────────────────────

/** `{INITIALS}-{YYYY}-{NNN}` — e.g. `JN-2026-004`. */
const INVOICE_NUMBER_RE = /^([A-Z]{1,4})-(\d{4})-(\d{3,})$/;

/** Initials to code into the number. `Person.initials` where set, else built
 *  from the name. Uppercased and stripped to A–Z so the number is safe to
 *  type, grep and sort; a person with no usable letters falls back to `INV`
 *  rather than producing `-2026-001`, which reads like a system reference
 *  instead of somebody's invoice. */
function initialsFor(p: {
  initials: string | null;
  firstName: string;
  lastName: string;
}): string {
  const raw =
    (p.initials ?? '').trim() ||
    `${p.firstName.charAt(0)}${p.lastName.charAt(0)}`;
  const cleaned = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  return cleaned.length > 0 ? cleaned : 'INV';
}

/**
 * Suggest the contractor's next invoice number.
 *
 * Sequence is per person and per year, derived from the numbers this
 * contractor has actually used rather than from a global counter: two
 * contractors invoicing in the same week must not be handed consecutive
 * numbers off one sequence, because each is numbering their OWN document and
 * a gap or a clash is theirs to explain to their accountant, not Foundry's.
 *
 * Only numbers matching the generated shape are considered when finding the
 * maximum. A contractor who types their own scheme (`ACME/0042`) keeps it and
 * is simply never renumbered into ours.
 *
 * This is a SUGGESTION. D1 (TT 2026-08-31) turns on the invoice being the
 * contractor's own document; a number they cannot change would make it a
 * recipient-created tax invoice, which needs a written agreement per
 * contractor that Foundry does not have. Prefilling is a convenience,
 * locking it is an RCTI.
 */
export async function suggestContractorInvoiceNumber(
  personId: string,
  now = new Date(),
): Promise<string | null> {
  const [first] = await suggestContractorInvoiceNumbers(personId, 1, now);
  return first ?? null;
}

/**
 * Suggest `count` consecutive numbers in one pass.
 *
 * Fees and expenses are separate documents (D7), so a contractor raising
 * both at once needs two numbers that don't collide with each other — not
 * two independent calls that would each return the same "next" value.
 */
export async function suggestContractorInvoiceNumbers(
  personId: string,
  count: number,
  now = new Date(),
): Promise<string[]> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { initials: true, firstName: true, lastName: true },
  });
  if (!person) return [];

  const prefix = `${initialsFor(person)}-${now.getUTCFullYear()}-`;
  const existing = await prisma.bill.findMany({
    where: {
      supplierPersonId: personId,
      supplierInvoiceNumber: { startsWith: prefix },
    },
    select: { supplierInvoiceNumber: true },
  });

  let max = 0;
  for (const b of existing) {
    const m = INVOICE_NUMBER_RE.exec(b.supplierInvoiceNumber ?? '');
    if (!m) continue;
    const n = Number(m[3]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    `${prefix}${String(max + 1 + i).padStart(3, '0')}`,
  );
}

/**
 * Has this contractor already issued under this number?
 *
 * The suggestion is only a default and the field is editable, so an edited
 * number can collide — with an earlier invoice of their own, or with the
 * suggestion if they raised one in another tab. Scoped to the person: two
 * different contractors using `INV-001` is normal and not a conflict.
 *
 * Deliberately NOT a unique index. One invoice legitimately becomes several
 * Bills (one per project) under the same supplier invoice number, so
 * uniqueness lives at the "did this person already use it" level, not at the
 * row level.
 */
export async function contractorInvoiceNumberTaken(
  personId: string,
  number: string,
): Promise<boolean> {
  const hit = await prisma.bill.findFirst({
    where: {
      supplierPersonId: personId,
      supplierInvoiceNumber: number.trim(),
    },
    select: { id: true },
  });
  // Loose on purpose: Prisma returns null, but anything nullish means "no
  // row found", and treating an undefined as a collision would block a
  // contractor from invoicing at all.
  return hit != null;
}

// ─── Fee vs expense invoices (TASK-517, D7/D8) ──────────────────────────

/** Fee bills — the contractor's time. GST is ADDED to hours × rate. */
export const CONTRACTOR_FEE_CATEGORY = 'Contractor — services';
/** Expense bills — costs recharged to Foundry, on their own invoice (D7). */
export const CONTRACTOR_EXPENSE_CATEGORY = 'Contractor — expenses';

/**
 * Recharge arithmetic for a contractor's expense lines (D8, TT 2026-10-23).
 *
 * This REVERSES D4. Under the old pass-through treatment the contractor
 * billed the GST-inclusive amount they paid, added no GST of their own, and
 * Foundry reclaimed the input credit on the original receipt. Under recharge
 * the contractor claims that credit themselves, bills Foundry the NET, and
 * adds 10% of their own on top — because the supply from contractor to
 * Foundry is their taxable supply of services, not a bare forwarding of
 * someone else's invoice.
 *
 * For a standard-rated cost the total is unchanged: A$110 inc GST becomes
 * A$100 net + A$10 GST. The difference bites on GST-FREE purchases —
 * overseas flights, basic food — where the net is the whole amount and 10%
 * is now genuinely added on top of it. That is the correct outcome for a
 * recharge, and it is the single most likely thing to surprise someone
 * reading a total, so it is worth knowing it is deliberate.
 *
 * Assumes a GST-registered contractor, which is everyone on the books
 * today. An unregistered contractor cannot add GST at all and would need
 * their expenses recharged at net with none — see the note on TASK-517.
 */
export function rechargeExpenseTotals(
  expenses: ReadonlyArray<{ amount: number; gst: number }>,
): { exGstCents: number; gstCents: number; totalCents: number } {
  // `amount` is what they paid, GST inclusive; `gst` is the component inside
  // it. The net is the difference, and is the whole amount for a GST-free
  // cost, where `gst` is 0.
  const exGstCents = expenses.reduce((sum, x) => sum + (x.amount - x.gst), 0);
  const gstCents = Math.round(exGstCents * 0.1);
  return { exGstCents, gstCents, totalCents: exGstCents + gstCents };
}
