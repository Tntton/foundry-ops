import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';
import { requireCapability } from '@/server/capabilities';

/**
 * Master ledger (TASK-069).
 *
 * One normalised row shape spanning every money flow in and out of the
 * firm, so an accountant / auditor can reconcile the whole picture from
 * a single sheet:
 *
 *   in  — Invoices (AR)
 *   out — Bills (AP), Expenses (reimbursables), PayRun lines
 *         (payroll / super / contractor-AP / supplier-AP), Contractor
 *         invoices (project cost)
 *   in/out — Bank transactions (the Xero bank feed; signed)
 *
 * Money stays integer AUD cents the whole way through — callers
 * serialise to decimal only at the CSV/xlsx boundary (TASK-069c). The
 * per-source `map*` functions are pure and exported for golden tests;
 * `buildLedger` wires the queries together, merges the latest audit
 * event per source row, filters, and sorts deterministically.
 *
 * This surface is PII-adjacent (PayRun lines carry BSB / account /
 * reference), so `buildLedger` re-checks `report.ledger.view` as
 * defence-in-depth even though the route gates it too.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type LedgerDirection = 'in' | 'out';

export type LedgerSourceType =
  | 'invoice'
  | 'bill'
  | 'expense'
  | 'payrun_line'
  | 'contractor_invoice'
  | 'bank_transaction';

export type LedgerRow = {
  direction: LedgerDirection;
  sourceType: LedgerSourceType;
  sourceId: string;
  /** External-ish reference: invoice number, supplier invoice no., ABA
   *  payment reference, contractor period label, or Xero txn id. */
  reference: string | null;
  counterpartyName: string | null;
  counterpartyAbn: string | null;
  projectCode: string | null;
  clientCode: string | null;
  /** FHB / FHP / FHO / FHX prefix derived from the project/client code
   *  or cost centre; null when the row isn't FH-series coded. */
  internalCode: string | null;
  category: string | null;
  costCentre: string | null;
  issueDate: Date | null;
  dueDate: Date | null;
  paidDate: Date | null;
  amountExGstCents: number | null;
  gstCents: number | null;
  amountTotalCents: number;
  amountPaidCents: number | null;
  currency: string;
  status: string | null;
  xeroId: string | null;
  // PII-bearing — only surfaced through the gated export.
  paymentReference: string | null;
  paymentBsb: string | null;
  paymentAccount: string | null;
  rebillable: boolean | null;
  rebilledOnInvoiceId: string | null;
  /** SharePoint pointer to the source document, when archived. */
  fileUrl: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  // Latest audit event on the source row (A9), merged in by buildLedger.
  lastAuditActorId: string | null;
  lastAuditAction: string | null;
  lastAuditAt: Date | null;
};

export type LedgerFilters = {
  direction?: LedgerDirection;
  /** Inclusive lower/upper bound on the row's primary date. */
  from?: Date;
  to?: Date;
  sourceTypes?: LedgerSourceType[];
  projectId?: string;
  clientId?: string;
  status?: string;
};

// Guardrail so a runaway history doesn't pull unbounded rows. At Foundry
// scale (~12 people) this is never hit; if it is, we log rather than
// silently truncate.
const SOURCE_TAKE_CAP = 20_000;

const INTERNAL_CODE_PREFIXES = ['FHB', 'FHP', 'FHO', 'FHX'] as const;

// ─── Pure helpers ───────────────────────────────────────────────────

/**
 * Derive the FH-series internal code (FHB/FHP/FHO/FHX) from the first
 * *present* code candidate. The first non-empty candidate decides: if it
 * carries an FH prefix that prefix is returned, otherwise null — a
 * client-coded row (e.g. project "IFM001") is client work, not internal,
 * even if a later fallback happens to be FH-coded. Empty/absent
 * candidates are skipped so callers can pass `project?.code` first and a
 * fallback (cost centre / client code) second. Never merges the `*000`
 * catch-alls — it only reports the 3-letter prefix.
 */
export function deriveInternalCode(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const c of candidates) {
    if (!c || !c.trim()) continue;
    const head = c.trim().slice(0, 3).toUpperCase();
    return (INTERNAL_CODE_PREFIXES as readonly string[]).includes(head)
      ? head
      : null;
  }
  return null;
}

/** The date a row sorts / filters on: its primary business date, else createdAt. */
function primaryDate(row: LedgerRow): Date {
  return row.issueDate ?? row.createdAt;
}

// ─── Per-source mappers (pure, exported for tests) ──────────────────

export type InvoiceRow = {
  id: string;
  number: string;
  status: string;
  issueDate: Date;
  dueDate: Date;
  paidAt: Date | null;
  amountExGst: number;
  gst: number;
  amountTotal: number;
  paymentReceivedAmount: number | null;
  xeroInvoiceId: string | null;
  taxInvoiceSharepointUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  project: { code: string } | null;
  client: { code: string; legalName: string; abn: string | null } | null;
};

export function mapInvoice(inv: InvoiceRow): LedgerRow {
  return {
    direction: 'in',
    sourceType: 'invoice',
    sourceId: inv.id,
    reference: inv.number,
    counterpartyName: inv.client?.legalName ?? null,
    counterpartyAbn: inv.client?.abn ?? null,
    projectCode: inv.project?.code ?? null,
    clientCode: inv.client?.code ?? null,
    internalCode: deriveInternalCode(inv.project?.code, inv.client?.code),
    category: 'revenue',
    costCentre: null,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    paidDate: inv.paidAt,
    amountExGstCents: inv.amountExGst,
    gstCents: inv.gst,
    amountTotalCents: inv.amountTotal,
    amountPaidCents: inv.paymentReceivedAmount,
    currency: 'AUD',
    status: inv.status,
    xeroId: inv.xeroInvoiceId,
    paymentReference: null,
    paymentBsb: null,
    paymentAccount: null,
    rebillable: null,
    rebilledOnInvoiceId: null,
    fileUrl: inv.taxInvoiceSharepointUrl,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
    lastAuditActorId: null,
    lastAuditAction: null,
    lastAuditAt: null,
  };
}

export type BillRow = {
  id: string;
  supplierName: string | null;
  supplierInvoiceNumber: string | null;
  issueDate: Date;
  dueDate: Date;
  amountTotal: number;
  gst: number;
  category: string;
  costCentre: string | null;
  status: string;
  xeroBillId: string | null;
  rebillable: boolean;
  rebilledOnInvoiceId: string | null;
  attachmentSharepointUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  supplier: { name: string; abn: string | null } | null;
  project: { code: string; client: { code: string } | null } | null;
};

export function mapBill(bill: BillRow): LedgerRow {
  return {
    direction: 'out',
    sourceType: 'bill',
    sourceId: bill.id,
    reference: bill.supplierInvoiceNumber,
    counterpartyName: bill.supplier?.name ?? bill.supplierName,
    counterpartyAbn: bill.supplier?.abn ?? null,
    projectCode: bill.project?.code ?? null,
    clientCode: bill.project?.client?.code ?? null,
    internalCode: deriveInternalCode(bill.project?.code, bill.costCentre),
    category: bill.category,
    costCentre: bill.costCentre,
    issueDate: bill.issueDate,
    dueDate: bill.dueDate,
    paidDate: null,
    amountExGstCents: bill.amountTotal - bill.gst,
    gstCents: bill.gst,
    amountTotalCents: bill.amountTotal,
    amountPaidCents: bill.status === 'paid' ? bill.amountTotal : null,
    currency: 'AUD',
    status: bill.status,
    xeroId: bill.xeroBillId,
    paymentReference: null,
    paymentBsb: null,
    paymentAccount: null,
    rebillable: bill.rebillable,
    rebilledOnInvoiceId: bill.rebilledOnInvoiceId,
    fileUrl: bill.attachmentSharepointUrl,
    createdAt: bill.createdAt,
    updatedAt: bill.updatedAt,
    lastAuditActorId: null,
    lastAuditAction: null,
    lastAuditAt: null,
  };
}

export type ExpenseRow = {
  id: string;
  date: Date;
  amount: number;
  currency: string;
  gst: number;
  category: string;
  vendor: string | null;
  status: string;
  xeroBillId: string | null;
  rebillable: boolean;
  rebilledOnInvoiceId: string | null;
  receiptSharepointUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  person: { firstName: string; lastName: string } | null;
  project: { code: string; client: { code: string } | null } | null;
};

export function mapExpense(exp: ExpenseRow): LedgerRow {
  const submitter = exp.person
    ? `${exp.person.firstName} ${exp.person.lastName}`.trim()
    : null;
  return {
    direction: 'out',
    sourceType: 'expense',
    sourceId: exp.id,
    reference: null,
    counterpartyName: exp.vendor ?? submitter,
    counterpartyAbn: null,
    projectCode: exp.project?.code ?? null,
    clientCode: exp.project?.client?.code ?? null,
    internalCode: deriveInternalCode(exp.project?.code),
    category: exp.category,
    costCentre: null,
    issueDate: exp.date,
    dueDate: null,
    paidDate: null,
    amountExGstCents: exp.amount - exp.gst,
    gstCents: exp.gst,
    amountTotalCents: exp.amount,
    amountPaidCents:
      exp.status === 'reimbursed' || exp.status === 'batched_for_payment'
        ? exp.amount
        : null,
    currency: exp.currency,
    status: exp.status,
    xeroId: exp.xeroBillId,
    paymentReference: null,
    paymentBsb: null,
    paymentAccount: null,
    rebillable: exp.rebillable,
    rebilledOnInvoiceId: exp.rebilledOnInvoiceId,
    fileUrl: exp.receiptSharepointUrl,
    createdAt: exp.createdAt,
    updatedAt: exp.updatedAt,
    lastAuditActorId: null,
    lastAuditAction: null,
    lastAuditAt: null,
  };
}

export type PayRunLineRow = {
  id: string;
  amount: number;
  bsb: string;
  acc: string;
  reference: string;
  personId: string | null;
  payRun: {
    type: string;
    status: string;
    periodEnd: Date;
    approvedAt: Date | null;
    xeroBatchRef: string | null;
    abaFileUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
};

export function mapPayRunLine(
  line: PayRunLineRow,
  payeeName: string | null,
): LedgerRow {
  const paid = line.payRun.status === 'paid' || line.payRun.status === 'reconciled';
  return {
    direction: 'out',
    sourceType: 'payrun_line',
    sourceId: line.id,
    reference: line.reference,
    counterpartyName: payeeName,
    counterpartyAbn: null,
    projectCode: null,
    clientCode: null,
    internalCode: null,
    category: line.payRun.type,
    costCentre: null,
    issueDate: line.payRun.periodEnd,
    dueDate: null,
    paidDate: paid ? line.payRun.approvedAt : null,
    amountExGstCents: null,
    gstCents: null,
    amountTotalCents: line.amount,
    amountPaidCents: paid ? line.amount : null,
    currency: 'AUD',
    status: line.payRun.status,
    xeroId: line.payRun.xeroBatchRef,
    paymentReference: line.reference,
    paymentBsb: line.bsb,
    paymentAccount: line.acc,
    rebillable: null,
    rebilledOnInvoiceId: null,
    fileUrl: line.payRun.abaFileUrl,
    createdAt: line.payRun.createdAt,
    updatedAt: line.payRun.updatedAt,
    lastAuditActorId: null,
    lastAuditAction: null,
    lastAuditAt: null,
  };
}

export type ContractorInvoiceRow = {
  id: string;
  amountExGst: number;
  gst: number;
  periodLabel: string;
  periodAnchor: Date;
  roleOnInvoice: string | null;
  createdAt: Date;
  updatedAt: Date;
  person: { firstName: string; lastName: string } | null;
  project: { code: string; client: { code: string } | null } | null;
};

export function mapContractorInvoice(ci: ContractorInvoiceRow): LedgerRow {
  return {
    direction: 'out',
    sourceType: 'contractor_invoice',
    sourceId: ci.id,
    reference: ci.periodLabel,
    counterpartyName: ci.person
      ? `${ci.person.firstName} ${ci.person.lastName}`.trim()
      : null,
    counterpartyAbn: null,
    projectCode: ci.project?.code ?? null,
    clientCode: ci.project?.client?.code ?? null,
    internalCode: deriveInternalCode(ci.project?.code),
    category: ci.roleOnInvoice ?? 'contractor',
    costCentre: null,
    issueDate: ci.periodAnchor,
    dueDate: null,
    paidDate: null,
    amountExGstCents: ci.amountExGst,
    gstCents: ci.gst,
    amountTotalCents: ci.amountExGst + ci.gst,
    amountPaidCents: null,
    currency: 'AUD',
    status: null,
    xeroId: null,
    paymentReference: null,
    paymentBsb: null,
    paymentAccount: null,
    rebillable: null,
    rebilledOnInvoiceId: null,
    fileUrl: null,
    createdAt: ci.createdAt,
    updatedAt: ci.updatedAt,
    lastAuditActorId: null,
    lastAuditAction: null,
    lastAuditAt: null,
  };
}

export type BankTxnRow = {
  id: string;
  xeroTxnId: string;
  date: Date;
  amount: number; // signed cents
  description: string | null;
  matchedType: string | null;
  createdAt: Date;
};

export function mapBankTransaction(txn: BankTxnRow): LedgerRow {
  return {
    direction: txn.amount >= 0 ? 'in' : 'out',
    sourceType: 'bank_transaction',
    sourceId: txn.id,
    reference: txn.xeroTxnId,
    counterpartyName: txn.description,
    counterpartyAbn: null,
    projectCode: null,
    clientCode: null,
    internalCode: null,
    category: txn.matchedType ? `matched:${txn.matchedType}` : 'unmatched',
    costCentre: null,
    issueDate: txn.date,
    dueDate: null,
    paidDate: txn.date,
    amountExGstCents: null,
    gstCents: null,
    amountTotalCents: Math.abs(txn.amount),
    amountPaidCents: Math.abs(txn.amount),
    currency: 'AUD',
    status: txn.matchedType ? 'matched' : 'unmatched',
    xeroId: txn.xeroTxnId,
    paymentReference: null,
    paymentBsb: null,
    paymentAccount: null,
    rebillable: null,
    rebilledOnInvoiceId: null,
    fileUrl: null,
    createdAt: txn.createdAt,
    updatedAt: null,
    lastAuditActorId: null,
    lastAuditAction: null,
    lastAuditAt: null,
  };
}

// ─── Filtering + ordering ───────────────────────────────────────────

/** Apply the in-memory filters. Exported for tests. */
export function applyLedgerFilters(
  rows: LedgerRow[],
  filters: LedgerFilters,
): LedgerRow[] {
  return rows.filter((r) => {
    if (filters.direction && r.direction !== filters.direction) return false;
    if (filters.sourceTypes && !filters.sourceTypes.includes(r.sourceType)) {
      return false;
    }
    if (filters.status && r.status !== filters.status) return false;
    if (filters.from && primaryDate(r) < filters.from) return false;
    if (filters.to && primaryDate(r) > filters.to) return false;
    return true;
  });
}

/** Deterministic order: date desc, then source type, then id. */
export function sortLedger(rows: LedgerRow[]): LedgerRow[] {
  return [...rows].sort((a, b) => {
    const da = primaryDate(a).getTime();
    const db = primaryDate(b).getTime();
    if (da !== db) return db - da;
    if (a.sourceType !== b.sourceType) {
      return a.sourceType < b.sourceType ? -1 : 1;
    }
    return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
  });
}

// ─── Audit merge ────────────────────────────────────────────────────

// Ledger source type → the AuditEvent.entityType string used for it.
const AUDIT_ENTITY_TYPE: Partial<Record<LedgerSourceType, string>> = {
  invoice: 'invoice',
  bill: 'bill',
  expense: 'expense',
};

type LatestAudit = { actorId: string | null; action: string; at: Date };

/** Overlay the latest audit event per (entityType, sourceId). Exported for tests. */
export function attachLatestAudit(
  rows: LedgerRow[],
  index: Map<string, LatestAudit>,
): LedgerRow[] {
  for (const row of rows) {
    const entityType = AUDIT_ENTITY_TYPE[row.sourceType];
    if (!entityType) continue;
    const hit = index.get(`${entityType}:${row.sourceId}`);
    if (hit) {
      row.lastAuditActorId = hit.actorId;
      row.lastAuditAction = hit.action;
      row.lastAuditAt = hit.at;
    }
  }
  return rows;
}

// ─── buildLedger ────────────────────────────────────────────────────

export async function buildLedger(
  session: Session,
  filters: LedgerFilters = {},
): Promise<LedgerRow[]> {
  // Defence-in-depth: the route gates this too, but the ledger is
  // PII-bearing so never build it for a caller who can't view it.
  requireCapability(session, 'report.ledger.view');
  return assembleLedger(filters);
}

/**
 * The unguarded ledger assembly. Callable from trusted system contexts
 * that have no user session (the nightly backup cron). User-facing
 * callers must go through `buildLedger`, which enforces the capability.
 */
export async function assembleLedger(
  filters: LedgerFilters = {},
): Promise<LedgerRow[]> {
  const projectWhere = filters.projectId ? { projectId: filters.projectId } : {};
  const clientWhere = filters.clientId ? { clientId: filters.clientId } : {};

  const [invoices, bills, expenses, payRunLines, contractorInvoices, bankTxns] =
    await Promise.all([
      prisma.invoice.findMany({
        where: { ...projectWhere, ...clientWhere },
        take: SOURCE_TAKE_CAP,
        orderBy: { issueDate: 'desc' },
        select: {
          id: true,
          number: true,
          status: true,
          issueDate: true,
          dueDate: true,
          paidAt: true,
          amountExGst: true,
          gst: true,
          amountTotal: true,
          paymentReceivedAmount: true,
          xeroInvoiceId: true,
          taxInvoiceSharepointUrl: true,
          createdAt: true,
          updatedAt: true,
          project: { select: { code: true } },
          client: { select: { code: true, legalName: true, abn: true } },
        },
      }),
      prisma.bill.findMany({
        where: { ...projectWhere },
        take: SOURCE_TAKE_CAP,
        orderBy: { issueDate: 'desc' },
        select: {
          id: true,
          supplierName: true,
          supplierInvoiceNumber: true,
          issueDate: true,
          dueDate: true,
          amountTotal: true,
          gst: true,
          category: true,
          costCentre: true,
          status: true,
          xeroBillId: true,
          rebillable: true,
          rebilledOnInvoiceId: true,
          attachmentSharepointUrl: true,
          createdAt: true,
          updatedAt: true,
          supplier: { select: { name: true, abn: true } },
          project: { select: { code: true, client: { select: { code: true } } } },
        },
      }),
      prisma.expense.findMany({
        where: { ...projectWhere },
        take: SOURCE_TAKE_CAP,
        orderBy: { date: 'desc' },
        select: {
          id: true,
          date: true,
          amount: true,
          currency: true,
          gst: true,
          category: true,
          vendor: true,
          status: true,
          xeroBillId: true,
          rebillable: true,
          rebilledOnInvoiceId: true,
          receiptSharepointUrl: true,
          createdAt: true,
          updatedAt: true,
          person: { select: { firstName: true, lastName: true } },
          project: { select: { code: true, client: { select: { code: true } } } },
        },
      }),
      // PayRun lines carry no project linkage, so a project/client filter
      // excludes them entirely (they're firm-level payroll/AP).
      filters.projectId || filters.clientId
        ? Promise.resolve([])
        : prisma.payRunLine.findMany({
            take: SOURCE_TAKE_CAP,
            select: {
              id: true,
              amount: true,
              bsb: true,
              acc: true,
              reference: true,
              personId: true,
              payRun: {
                select: {
                  type: true,
                  status: true,
                  periodEnd: true,
                  approvedAt: true,
                  xeroBatchRef: true,
                  abaFileUrl: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            },
          }),
      prisma.contractorInvoice.findMany({
        where: { ...projectWhere },
        take: SOURCE_TAKE_CAP,
        orderBy: { periodAnchor: 'desc' },
        select: {
          id: true,
          amountExGst: true,
          gst: true,
          periodLabel: true,
          periodAnchor: true,
          roleOnInvoice: true,
          createdAt: true,
          updatedAt: true,
          person: { select: { firstName: true, lastName: true } },
          project: { select: { code: true, client: { select: { code: true } } } },
        },
      }),
      // Bank transactions aren't project/client tagged either.
      filters.projectId || filters.clientId
        ? Promise.resolve([])
        : prisma.bankTransaction.findMany({
            take: SOURCE_TAKE_CAP,
            orderBy: { date: 'desc' },
            select: {
              id: true,
              xeroTxnId: true,
              date: true,
              amount: true,
              description: true,
              matchedType: true,
              createdAt: true,
            },
          }),
    ]);

  for (const [name, arr] of [
    ['invoices', invoices],
    ['bills', bills],
    ['expenses', expenses],
    ['payRunLines', payRunLines],
    ['contractorInvoices', contractorInvoices],
    ['bankTxns', bankTxns],
  ] as const) {
    if (arr.length >= SOURCE_TAKE_CAP) {
      console.warn(
        `[ledger] ${name} hit the ${SOURCE_TAKE_CAP}-row cap — result may be truncated.`,
      );
    }
  }

  // Resolve payee names for payroll lines (no Person relation on the model).
  const payeeIds = Array.from(
    new Set(payRunLines.map((l) => l.personId).filter((x): x is string => !!x)),
  );
  const payees = payeeIds.length
    ? await prisma.person.findMany({
        where: { id: { in: payeeIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const payeeName = new Map(
    payees.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]),
  );

  const rows: LedgerRow[] = [
    ...invoices.map(mapInvoice),
    ...bills.map(mapBill),
    ...expenses.map(mapExpense),
    ...payRunLines.map((l) =>
      mapPayRunLine(l, l.personId ? (payeeName.get(l.personId) ?? null) : null),
    ),
    ...contractorInvoices.map(mapContractorInvoice),
    ...bankTxns.map(mapBankTransaction),
  ];

  // Merge the latest audit event for the human-mutated sources.
  const auditTargets = rows.filter((r) => AUDIT_ENTITY_TYPE[r.sourceType]);
  if (auditTargets.length) {
    const auditRows = await prisma.auditEvent.findMany({
      where: {
        OR: Object.entries(AUDIT_ENTITY_TYPE).map(([sourceType, entityType]) => ({
          entityType: entityType as string,
          entityId: {
            in: auditTargets
              .filter((r) => r.sourceType === sourceType)
              .map((r) => r.sourceId),
          },
        })),
      },
      orderBy: { at: 'desc' },
      select: { entityType: true, entityId: true, action: true, actorId: true, at: true },
    });
    const index = new Map<string, LatestAudit>();
    for (const a of auditRows) {
      const key = `${a.entityType}:${a.entityId}`;
      // orderBy at desc → first seen per key is the latest.
      if (!index.has(key)) {
        index.set(key, { actorId: a.actorId, action: a.action, at: a.at });
      }
    }
    attachLatestAudit(rows, index);
  }

  return sortLedger(applyLedgerFilters(rows, filters));
}
