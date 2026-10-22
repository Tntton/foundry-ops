import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';

/**
 * TASK-069 · master ledger aggregation. Golden fixtures: one row of
 * every source type through its pure mapper (asserting direction sign,
 * field mapping, and internal-code derivation), plus the filter / sort /
 * audit-merge helpers, and a buildLedger integration pass over a mocked
 * Prisma that proves assembly + ordering + audit overlay + the
 * capability gate.
 */

// Mock the DB so buildLedger's queries are controllable. The pure
// mappers under test don't touch it.
const db = vi.hoisted(() => ({
  invoice: { findMany: vi.fn() },
  bill: { findMany: vi.fn() },
  expense: { findMany: vi.fn() },
  payRunLine: { findMany: vi.fn() },
  contractorInvoice: { findMany: vi.fn() },
  bankTransaction: { findMany: vi.fn() },
  person: { findMany: vi.fn() },
  auditEvent: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import {
  buildLedger,
  deriveInternalCode,
  mapInvoice,
  mapBill,
  mapExpense,
  mapPayRunLine,
  mapContractorInvoice,
  mapBankTransaction,
  applyLedgerFilters,
  sortLedger,
  attachLatestAudit,
  type LedgerRow,
} from '@/server/reports/ledger';

function sessionWith(roles: string[]): Session {
  return {
    person: {
      id: 'p1',
      email: 'x@foundry.health',
      firstName: 'A',
      lastName: 'B',
      initials: 'AB',
      roles: roles as Session['person']['roles'],
      headshotUrl: null,
      band: 'Partner' as Session['person']['band'],
    },
    realRoles: roles as Session['realRoles'],
    isRealSuperAdmin: roles.includes('super_admin'),
    viewAsRoles: null,
  };
}

const D = (s: string) => new Date(s);

// ─── deriveInternalCode ─────────────────────────────────────────────

describe('deriveInternalCode', () => {
  it('reads the FH-series prefix from a code', () => {
    expect(deriveInternalCode('FHO000')).toBe('FHO');
    expect(deriveInternalCode('FHB123')).toBe('FHB');
    expect(deriveInternalCode('fhp5')).toBe('FHP');
    expect(deriveInternalCode('FHX999')).toBe('FHX');
  });
  it('returns null for client-coded or empty values', () => {
    expect(deriveInternalCode('IFM001')).toBeNull();
    expect(deriveInternalCode(null, undefined, '')).toBeNull();
  });
  it('takes the first candidate that carries a code', () => {
    expect(deriveInternalCode(null, 'FHO001')).toBe('FHO');
    expect(deriveInternalCode('IFM001', 'FHB000')).toBeNull(); // IFM wins as first non-empty
  });
});

// ─── Pure mappers (golden, one per source) ──────────────────────────

describe('mapInvoice', () => {
  it('maps an AR invoice to an "in" row with the file pointer', () => {
    const row = mapInvoice({
      id: 'inv1',
      number: 'IFM001-INV-12',
      status: 'sent',
      issueDate: D('2026-07-08'),
      dueDate: D('2026-08-07'),
      paidAt: null,
      amountExGst: 17000,
      gst: 1700,
      amountTotal: 18700,
      paymentReceivedAmount: null,
      xeroInvoiceId: 'xero-inv-1',
      taxInvoiceSharepointUrl: 'https://sp/inv.pdf',
      createdAt: D('2026-07-08'),
      updatedAt: D('2026-07-09'),
      project: { code: 'IFM001' },
      client: { code: 'IFM', legalName: 'Ivory Foods Ltd', abn: '11222333444' },
    });
    expect(row).toMatchObject({
      direction: 'in',
      sourceType: 'invoice',
      reference: 'IFM001-INV-12',
      counterpartyName: 'Ivory Foods Ltd',
      counterpartyAbn: '11222333444',
      clientCode: 'IFM',
      internalCode: null,
      amountExGstCents: 17000,
      gstCents: 1700,
      amountTotalCents: 18700,
      xeroId: 'xero-inv-1',
      fileUrl: 'https://sp/inv.pdf',
    });
  });
});

describe('mapBill', () => {
  it('maps an AP bill to an "out" row, computing ex-GST and internal code', () => {
    const row = mapBill({
      id: 'bill1',
      supplierName: 'Legacy Co',
      supplierInvoiceNumber: 'SUP-99',
      issueDate: D('2026-07-01'),
      dueDate: D('2026-07-31'),
      amountTotal: 11000,
      gst: 1000,
      category: 'subscriptions',
      costCentre: 'FHO000',
      status: 'paid',
      xeroBillId: 'xero-bill-1',
      rebillable: true,
      rebilledOnInvoiceId: 'inv1',
      attachmentSharepointUrl: 'https://sp/bill.pdf',
      createdAt: D('2026-07-01'),
      updatedAt: D('2026-07-02'),
      supplier: { name: 'Structured Supplier', abn: '55666777888' },
      project: null,
    });
    expect(row).toMatchObject({
      direction: 'out',
      sourceType: 'bill',
      counterpartyName: 'Structured Supplier', // structured supplier wins over free-text
      counterpartyAbn: '55666777888',
      internalCode: 'FHO', // derived from costCentre
      amountExGstCents: 10000,
      gstCents: 1000,
      amountTotalCents: 11000,
      amountPaidCents: 11000, // status 'paid'
      rebillable: true,
      fileUrl: 'https://sp/bill.pdf',
    });
  });
});

describe('mapExpense', () => {
  it('maps a reimbursable expense to an "out" row', () => {
    const row = mapExpense({
      id: 'exp1',
      date: D('2026-07-05'),
      amount: 2200,
      currency: 'AUD',
      gst: 200,
      category: 'travel',
      vendor: 'Uber',
      status: 'submitted',
      xeroBillId: null,
      rebillable: false,
      rebilledOnInvoiceId: null,
      receiptSharepointUrl: 'https://sp/receipt.jpg',
      createdAt: D('2026-07-05'),
      updatedAt: D('2026-07-05'),
      person: { firstName: 'Jas', lastName: 'Navarro' },
      project: { code: 'FHP001', client: { code: 'FHP' } },
    });
    expect(row).toMatchObject({
      direction: 'out',
      sourceType: 'expense',
      counterpartyName: 'Uber',
      amountExGstCents: 2000,
      gstCents: 200,
      amountTotalCents: 2200,
      amountPaidCents: null, // not yet reimbursed
      internalCode: 'FHP',
      fileUrl: 'https://sp/receipt.jpg',
    });
  });
});

describe('mapPayRunLine', () => {
  it('maps a payroll line to an "out" row carrying the payment refs', () => {
    const row = mapPayRunLine(
      {
        id: 'prl1',
        amount: 850000,
        bsb: '062-000',
        acc: '12345678',
        reference: 'SALARY JUL',
        personId: 'p9',
        payRun: {
          type: 'payroll',
          status: 'paid',
          periodEnd: D('2026-07-31'),
          approvedAt: D('2026-07-30'),
          xeroBatchRef: 'batch-1',
          abaFileUrl: 'https://sp/aba.aba',
          createdAt: D('2026-07-28'),
          updatedAt: D('2026-07-30'),
        },
      },
      'Rachael Spooner',
    );
    expect(row).toMatchObject({
      direction: 'out',
      sourceType: 'payrun_line',
      counterpartyName: 'Rachael Spooner',
      category: 'payroll',
      amountTotalCents: 850000,
      amountPaidCents: 850000,
      paymentReference: 'SALARY JUL',
      paymentBsb: '062-000',
      paymentAccount: '12345678',
      xeroId: 'batch-1',
      fileUrl: 'https://sp/aba.aba',
    });
  });
});

describe('mapContractorInvoice', () => {
  it('maps a contractor invoice to an "out" row (ex-GST + gst → total)', () => {
    const row = mapContractorInvoice({
      id: 'ci1',
      amountExGst: 500000,
      gst: 50000,
      periodLabel: 'Jul-26',
      periodAnchor: D('2026-07-01'),
      roleOnInvoice: 'Senior Manager',
      createdAt: D('2026-07-15'),
      updatedAt: D('2026-07-15'),
      person: { firstName: 'Chris', lastName: 'Tan' },
      project: { code: 'IFM001', client: { code: 'IFM' } },
    });
    expect(row).toMatchObject({
      direction: 'out',
      sourceType: 'contractor_invoice',
      reference: 'Jul-26',
      counterpartyName: 'Chris Tan',
      category: 'Senior Manager',
      amountExGstCents: 500000,
      gstCents: 50000,
      amountTotalCents: 550000,
    });
  });
});

describe('mapBankTransaction', () => {
  it('derives direction from the signed amount (money in)', () => {
    const row = mapBankTransaction({
      id: 'bt1',
      xeroTxnId: 'xtx-1',
      date: D('2026-07-20'),
      amount: 18700,
      description: 'Ivory Foods payment',
      matchedType: 'invoice',
      createdAt: D('2026-07-20'),
    });
    expect(row.direction).toBe('in');
    expect(row.amountTotalCents).toBe(18700);
    expect(row.status).toBe('matched');
  });
  it('derives "out" and absolute magnitude for a spend', () => {
    const row = mapBankTransaction({
      id: 'bt2',
      xeroTxnId: 'xtx-2',
      date: D('2026-07-21'),
      amount: -5000,
      description: 'AWS',
      matchedType: null,
      createdAt: D('2026-07-21'),
    });
    expect(row.direction).toBe('out');
    expect(row.amountTotalCents).toBe(5000);
    expect(row.status).toBe('unmatched');
  });
});

// ─── Filters / sort / audit merge ───────────────────────────────────

const mkRow = (over: Partial<LedgerRow>): LedgerRow => ({
  direction: 'out',
  sourceType: 'bill',
  sourceId: 'x',
  reference: null,
  counterpartyName: null,
  counterpartyAbn: null,
  projectCode: null,
  clientCode: null,
  internalCode: null,
  category: null,
  costCentre: null,
  issueDate: D('2026-07-01'),
  dueDate: null,
  paidDate: null,
  amountExGstCents: null,
  gstCents: null,
  amountTotalCents: 0,
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
  createdAt: D('2026-07-01'),
  updatedAt: null,
  lastAuditActorId: null,
  lastAuditAction: null,
  lastAuditAt: null,
  ...over,
});

describe('applyLedgerFilters', () => {
  const rows = [
    mkRow({ sourceId: 'a', direction: 'in', sourceType: 'invoice', status: 'sent', issueDate: D('2026-07-10') }),
    mkRow({ sourceId: 'b', direction: 'out', sourceType: 'bill', status: 'paid', issueDate: D('2026-06-01') }),
  ];
  it('filters by direction', () => {
    expect(applyLedgerFilters(rows, { direction: 'in' }).map((r) => r.sourceId)).toEqual(['a']);
  });
  it('filters by source type + status', () => {
    expect(applyLedgerFilters(rows, { sourceTypes: ['bill'], status: 'paid' }).map((r) => r.sourceId)).toEqual(['b']);
  });
  it('filters by date range (inclusive)', () => {
    expect(applyLedgerFilters(rows, { from: D('2026-07-01') }).map((r) => r.sourceId)).toEqual(['a']);
  });
});

describe('sortLedger', () => {
  it('orders by date desc, then source type, then id', () => {
    const out = sortLedger([
      mkRow({ sourceId: 'old', issueDate: D('2026-06-01') }),
      mkRow({ sourceId: 'z', sourceType: 'expense', issueDate: D('2026-07-10') }),
      mkRow({ sourceId: 'a', sourceType: 'bill', issueDate: D('2026-07-10') }),
    ]);
    expect(out.map((r) => r.sourceId)).toEqual(['a', 'z', 'old']);
  });
});

describe('attachLatestAudit', () => {
  it('overlays the latest audit only onto human-mutated sources', () => {
    const rows = [
      mkRow({ sourceId: 'inv1', sourceType: 'invoice' }),
      mkRow({ sourceId: 'bt1', sourceType: 'bank_transaction' }),
    ];
    const index = new Map([
      ['invoice:inv1', { actorId: 'p_tt', action: 'approved', at: D('2026-07-09') }],
    ]);
    attachLatestAudit(rows, index);
    expect(rows[0]!.lastAuditAction).toBe('approved');
    expect(rows[0]!.lastAuditActorId).toBe('p_tt');
    expect(rows[1]!.lastAuditAction).toBeNull(); // bank txns aren't audit-tracked
  });
});

// ─── buildLedger integration (mocked Prisma) ────────────────────────

describe('buildLedger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.invoice.findMany.mockResolvedValue([]);
    db.bill.findMany.mockResolvedValue([]);
    db.expense.findMany.mockResolvedValue([]);
    db.payRunLine.findMany.mockResolvedValue([]);
    db.contractorInvoice.findMany.mockResolvedValue([]);
    db.bankTransaction.findMany.mockResolvedValue([]);
    db.person.findMany.mockResolvedValue([]);
    db.auditEvent.findMany.mockResolvedValue([]);
  });

  it('throws for a caller without report.ledger.view', async () => {
    await expect(buildLedger(sessionWith(['manager']))).rejects.toThrow();
  });

  it('assembles + sorts across sources and overlays audit', async () => {
    db.invoice.findMany.mockResolvedValue([
      {
        id: 'inv1',
        number: 'IFM001-INV-12',
        status: 'sent',
        issueDate: D('2026-07-10'),
        dueDate: D('2026-08-09'),
        paidAt: null,
        amountExGst: 17000,
        gst: 1700,
        amountTotal: 18700,
        paymentReceivedAmount: null,
        xeroInvoiceId: null,
        taxInvoiceSharepointUrl: null,
        createdAt: D('2026-07-10'),
        updatedAt: D('2026-07-10'),
        project: { code: 'IFM001' },
        client: { code: 'IFM', legalName: 'Ivory Foods', abn: null },
      },
    ]);
    db.bill.findMany.mockResolvedValue([
      {
        id: 'bill1',
        supplierName: 'AWS',
        supplierInvoiceNumber: 'A-1',
        issueDate: D('2026-06-01'),
        dueDate: D('2026-06-30'),
        amountTotal: 11000,
        gst: 1000,
        category: 'hosting',
        costCentre: null,
        status: 'approved',
        xeroBillId: null,
        rebillable: false,
        rebilledOnInvoiceId: null,
        attachmentSharepointUrl: null,
        createdAt: D('2026-06-01'),
        updatedAt: D('2026-06-01'),
        supplier: null,
        project: null,
      },
    ]);
    db.auditEvent.findMany.mockResolvedValue([
      { entityType: 'invoice', entityId: 'inv1', action: 'approved', actorId: 'p_tt', at: D('2026-07-11') },
      { entityType: 'invoice', entityId: 'inv1', action: 'created', actorId: 'p_tt', at: D('2026-07-10') },
    ]);

    const rows = await buildLedger(sessionWith(['super_admin']));
    expect(rows.map((r) => r.sourceId)).toEqual(['inv1', 'bill1']); // date desc
    expect(rows[0]!.direction).toBe('in');
    expect(rows[0]!.lastAuditAction).toBe('approved'); // latest, not 'created'
    expect(rows[1]!.direction).toBe('out');
    expect(rows[1]!.lastAuditAction).toBeNull(); // no audit rows for the bill
  });

  it('resolves payee names for payroll lines', async () => {
    db.payRunLine.findMany.mockResolvedValue([
      {
        id: 'prl1',
        amount: 850000,
        bsb: '062-000',
        acc: '12345678',
        reference: 'SALARY',
        personId: 'p9',
        payRun: {
          type: 'payroll',
          status: 'paid',
          periodEnd: D('2026-07-31'),
          approvedAt: D('2026-07-30'),
          xeroBatchRef: null,
          abaFileUrl: null,
          createdAt: D('2026-07-28'),
          updatedAt: D('2026-07-30'),
        },
      },
    ]);
    db.person.findMany.mockResolvedValue([
      { id: 'p9', firstName: 'Rachael', lastName: 'Spooner' },
    ]);

    const rows = await buildLedger(sessionWith(['admin']));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.counterpartyName).toBe('Rachael Spooner');
    expect(rows[0]!.paymentBsb).toBe('062-000');
  });
});
