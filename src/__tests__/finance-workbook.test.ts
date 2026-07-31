import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { financeSheets } from '@/server/exports/finance-workbook';
import { buildWorkbookBuffer } from '@/server/exports/excel-workbook';
import type { FirmPnL } from '@/server/reports/pnl';
import type { CashflowForecast } from '@/server/reports/cashflow';
import type { FirmAging } from '@/server/reports/ar-aging';
import type { FirmApAging } from '@/server/reports/ap-aging';

/**
 * TASK-061 · Finance.xlsx sheet assembly. `financeSheets` is pure, so we
 * feed it fixture aggregates and assert the four sheets, headers, numeric
 * money, and the P&L totals row — then round-trip through SheetJS.
 */

const pnl = {
  projects: [
    {
      projectId: 'p1',
      code: 'IFM001',
      name: 'Galileo',
      stage: 'delivery',
      clientCode: 'IFM',
      contractValueCents: 10_000_000,
      revenueCents: 4_000_000,
      wipCents: 500_000,
      consultantCostCents: 1_500_000,
      projectExpenseCents: 200_000,
      costCents: 1_700_000,
      marginCents: 2_800_000,
      hours: 120,
    },
  ],
  totals: {
    contractValueCents: 10_000_000,
    revenueCents: 4_000_000,
    wipCents: 500_000,
    consultantCostCents: 1_500_000,
    projectExpenseCents: 200_000,
    firmOpexCents: 0,
    costCents: 1_700_000,
    grossProfitCents: 2_300_000,
    ebitCents: 2_300_000,
    marginCents: 2_800_000,
    hours: 120,
  },
  monthly: [],
  cumulative: { revenueCents: 0, receivedCents: 0, contractsWonCents: 0 },
} as unknown as FirmPnL;

const cash = {
  buckets: [
    {
      label: '2026-08-03',
      rangeStart: new Date('2026-08-03'),
      rangeEnd: new Date('2026-08-10'),
      arExpectedCents: 1_000_000,
      apDueCents: 400_000,
      netCents: 600_000,
    },
  ],
  totals: {
    arExpectedCents: 1_000_000,
    apDueCents: 400_000,
    netCents: 600_000,
    arOverdueCents: 0,
    apOverdueCents: 0,
  },
  horizonWeeks: 12,
} as CashflowForecast;

const ar = {
  totalOutstandingCents: 900_000,
  bucketTotals: { not_due: 900_000, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
  invoiceCount: 1,
  oldestOverdueDays: null,
  byClient: [
    {
      clientId: 'c1',
      code: 'IFM',
      legalName: 'Ivory Foods',
      totalOutstandingCents: 900_000,
      bucketCents: { not_due: 900_000, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
      invoices: [
        {
          id: 'inv1',
          number: 'IFM001-INV-12',
          status: 'sent',
          issueDate: new Date('2026-07-08'),
          dueDate: new Date('2026-08-07'),
          amountTotalCents: 900_000,
          paidCents: 0,
          outstandingCents: 900_000,
          daysOverdue: -20,
          bucket: 'not_due' as const,
          client: { id: 'c1', code: 'IFM', legalName: 'Ivory Foods' },
          project: { code: 'IFM001' },
        },
      ],
    },
  ],
} as FirmAging;

const ap = {
  totalOutstandingCents: 110_000,
  bucketTotals: { not_due: 110_000, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
  billCount: 1,
  oldestOverdueDays: null,
  bySupplier: [
    {
      key: 'aws',
      supplierName: 'AWS',
      supplierPersonId: null,
      totalOutstandingCents: 110_000,
      bucketCents: { not_due: 110_000, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
      bills: [
        {
          id: 'b1',
          supplierName: 'AWS',
          supplierPersonId: null,
          supplierInvoiceNumber: 'A-1',
          issueDate: new Date('2026-07-01'),
          dueDate: new Date('2026-07-31'),
          amountTotalCents: 110_000,
          category: 'hosting',
          status: 'approved',
          daysOverdue: 0,
          bucket: 'not_due' as const,
          rebillable: false,
          rebilledOnInvoiceId: null,
          project: null,
        },
      ],
    },
  ],
  rebillablePendingCents: 0,
} as unknown as FirmApAging;

describe('financeSheets', () => {
  it('builds P&L / Cash / AR aging / AP aging sheets', () => {
    const sheets = financeSheets(pnl, cash, ar, ap);
    expect(sheets.map((s) => s.name)).toEqual([
      'P&L',
      'Cash',
      'AR aging',
      'AP aging',
    ]);
  });

  it('renders money numerically and appends a P&L TOTAL row', () => {
    const buf = buildWorkbookBuffer(financeSheets(pnl, cash, ar, ap));
    const wb = XLSX.read(buf, { type: 'buffer' });
    const pnlRows = XLSX.utils.sheet_to_json(wb.Sheets['P&L']!, {
      header: 1,
      blankrows: false,
    }) as unknown[][];
    // header + 1 project + TOTAL
    expect(pnlRows).toHaveLength(3);
    expect(pnlRows[1]![0]).toBe('IFM001');
    // Revenue column (index 5) numeric = 4,000,000 cents / 100.
    expect(pnlRows[1]![5]).toBe(40000);
    expect(pnlRows[2]![0]).toBe('TOTAL');
  });

  it('flattens AR + AP rows from their nested aggregates', () => {
    const buf = buildWorkbookBuffer(financeSheets(pnl, cash, ar, ap));
    const wb = XLSX.read(buf, { type: 'buffer' });
    const arRows = XLSX.utils.sheet_to_json(wb.Sheets['AR aging']!, { header: 1, blankrows: false });
    const apRows = XLSX.utils.sheet_to_json(wb.Sheets['AP aging']!, { header: 1, blankrows: false });
    expect(arRows).toHaveLength(2); // header + 1 invoice
    expect(apRows).toHaveLength(2); // header + 1 bill
  });
});
