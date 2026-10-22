import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  LEDGER_HEADER,
  ledgerToCsv,
  ledgerToWorkbook,
} from '@/server/reports/ledger-export';
import type { LedgerRow } from '@/server/reports/ledger';

/**
 * TASK-069c · export serialisation + route gate. Asserts CSV/xlsx header
 * + row counts, that money renders correctly in each format, and that
 * the export endpoint refuses callers without `report.ledger.export`.
 */

// Route imports getSession; mock it for the gate test.
const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/server/session', () => ({ getSession }));

const base: LedgerRow = {
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
  issueDate: new Date('2026-07-01'),
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
  createdAt: new Date('2026-07-01'),
  updatedAt: null,
  lastAuditActorId: null,
  lastAuditAction: null,
  lastAuditAt: null,
};

const rows: LedgerRow[] = [
  {
    ...base,
    direction: 'in',
    sourceType: 'invoice',
    sourceId: 'inv1',
    reference: 'IFM001-INV-12',
    amountExGstCents: 17000,
    gstCents: 1700,
    amountTotalCents: 18700,
  },
  {
    ...base,
    direction: 'out',
    sourceType: 'payrun_line',
    sourceId: 'prl1',
    amountTotalCents: 850000,
    paymentReference: 'SALARY',
    paymentBsb: '062-000',
    paymentAccount: '12345678',
  },
];

describe('ledgerToCsv', () => {
  it('emits the full header and one line per row', () => {
    const csv = ledgerToCsv(rows);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(LEDGER_HEADER.join(','));
    expect(lines).toHaveLength(1 + rows.length);
  });
  it('renders money as a plain 2dp decimal and includes full payment refs', () => {
    const csv = ledgerToCsv(rows);
    expect(csv).toContain('187.00'); // 18700 cents
    expect(csv).toContain('8500.00'); // 850000 cents
    expect(csv).toContain('12345678'); // full account (PII-bearing export)
    expect(csv).toContain('062-000');
  });
});

describe('ledgerToWorkbook', () => {
  it('produces All / Receivables / Payables sheets with correct counts', () => {
    const buf = ledgerToWorkbook(rows);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['All', 'Receivables (in)', 'Payables (out)']);

    const count = (name: string) =>
      (XLSX.utils.sheet_to_json(wb.Sheets[name]!, { header: 1, blankrows: false })
        .length as number) - 1; // minus header row
    expect(count('All')).toBe(2);
    expect(count('Receivables (in)')).toBe(1);
    expect(count('Payables (out)')).toBe(1);
  });
  it('keeps money numeric so Excel can sum it', () => {
    const buf = ledgerToWorkbook(rows);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const all = XLSX.utils.sheet_to_json(wb.Sheets['All']!, { header: 1, blankrows: false }) as unknown[][];
    const totalIdx = LEDGER_HEADER.indexOf('Total');
    // Invoice row total = 18700 cents → 187 dollars, numeric.
    const invoiceRow = all.find((r) => r[LEDGER_HEADER.indexOf('Reference')] === 'IFM001-INV-12');
    expect(typeof invoiceRow![totalIdx]).toBe('number');
    expect(invoiceRow![totalIdx]).toBe(187);
  });
});

describe('GET /api/reports/ledger gate', () => {
  it('403s a caller without report.ledger.export', async () => {
    getSession.mockResolvedValue({
      person: { id: 'p1', roles: ['manager'] },
    });
    const { GET } = await import('@/app/api/reports/ledger/route');
    const res = await GET(new Request('https://x/api/reports/ledger?format=csv'));
    expect(res.status).toBe(403);
  });
});
