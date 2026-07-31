import {
  buildWorkbookBuffer,
  type WorkbookSheet,
} from '@/server/exports/excel-workbook';
import { computeFirmPnL, type FirmPnL } from '@/server/reports/pnl';
import { computeCashflow, type CashflowForecast } from '@/server/reports/cashflow';
import { computeFirmAging, type FirmAging } from '@/server/reports/ar-aging';
import { computeFirmApAging, type FirmApAging } from '@/server/reports/ap-aging';

/**
 * Finance.xlsx (TASK-061) — P&L / Cash / AR aging / AP aging, one sheet
 * each, drawn from the same aggregators the on-screen reports use so the
 * workbook can never drift from the app. Money renders as numeric dollar
 * values so Excel can sum the columns. `financeSheets` is pure (takes the
 * already-computed objects) and exported for tests.
 */

const d = (cents: number): number => cents / 100;
const ymd = (date: Date): string => date.toISOString().slice(0, 10);

function pnlSheet(pnl: FirmPnL): WorkbookSheet {
  const rows = pnl.projects.map((p) => [
    p.code,
    p.name,
    p.clientCode,
    p.stage,
    d(p.contractValueCents),
    d(p.revenueCents),
    d(p.wipCents),
    d(p.consultantCostCents),
    d(p.projectExpenseCents),
    d(p.marginCents),
    p.hours,
  ]);
  // Trailing firm-totals row.
  rows.push([
    'TOTAL',
    '',
    '',
    '',
    d(pnl.totals.contractValueCents),
    d(pnl.totals.revenueCents),
    d(pnl.totals.wipCents),
    d(pnl.totals.consultantCostCents),
    d(pnl.totals.projectExpenseCents),
    d(pnl.totals.marginCents),
    pnl.totals.hours,
  ]);
  return {
    name: 'P&L',
    header: [
      'Project',
      'Name',
      'Client',
      'Stage',
      'Contract',
      'Revenue',
      'WIP',
      'Consultant cost',
      'Project expense',
      'Margin',
      'Hours',
    ],
    rows,
  };
}

function cashSheet(cash: CashflowForecast): WorkbookSheet {
  return {
    name: 'Cash',
    header: ['Week', 'AR expected', 'AP due', 'Net'],
    rows: cash.buckets.map((b) => [
      b.label,
      d(b.arExpectedCents),
      d(b.apDueCents),
      d(b.netCents),
    ]),
  };
}

function arSheet(ar: FirmAging): WorkbookSheet {
  const rows = ar.byClient.flatMap((c) =>
    c.invoices.map((inv) => [
      c.code,
      inv.number,
      inv.status,
      ymd(inv.issueDate),
      ymd(inv.dueDate),
      d(inv.amountTotalCents),
      d(inv.paidCents),
      d(inv.outstandingCents),
      inv.daysOverdue,
      inv.bucket,
    ]),
  );
  return {
    name: 'AR aging',
    header: [
      'Client',
      'Invoice',
      'Status',
      'Issued',
      'Due',
      'Total',
      'Paid',
      'Outstanding',
      'Days overdue',
      'Bucket',
    ],
    rows,
  };
}

function apSheet(ap: FirmApAging): WorkbookSheet {
  const rows = ap.bySupplier.flatMap((s) =>
    s.bills.map((b) => [
      s.supplierName,
      b.supplierInvoiceNumber ?? '',
      b.project?.code ?? '',
      b.category,
      b.status,
      ymd(b.issueDate),
      ymd(b.dueDate),
      d(b.amountTotalCents),
      b.daysOverdue,
      b.bucket,
    ]),
  );
  return {
    name: 'AP aging',
    header: [
      'Supplier',
      'Ref',
      'Project',
      'Category',
      'Status',
      'Issued',
      'Due',
      'Total',
      'Days overdue',
      'Bucket',
    ],
    rows,
  };
}

/** Pure — assemble the four Finance sheets from computed aggregates. */
export function financeSheets(
  pnl: FirmPnL,
  cash: CashflowForecast,
  ar: FirmAging,
  ap: FirmApAging,
): WorkbookSheet[] {
  return [pnlSheet(pnl), cashSheet(cash), arSheet(ar), apSheet(ap)];
}

/** Gather the aggregates and build the Finance workbook buffer. */
export async function buildFinanceWorkbook(): Promise<Buffer> {
  const [pnl, cash, ar, ap] = await Promise.all([
    computeFirmPnL(),
    computeCashflow(),
    computeFirmAging(),
    computeFirmApAging(),
  ]);
  return buildWorkbookBuffer(financeSheets(pnl, cash, ar, ap));
}
