import { toCsv, centsToDecimal } from '@/server/reports/csv';
import {
  buildWorkbookBuffer,
  type WorkbookCell,
} from '@/server/exports/excel-workbook';
import type { LedgerRow } from '@/server/reports/ledger';

/**
 * Serialise ledger rows to CSV / xlsx for the accountant + audit export
 * (TASK-069c). This is the PII-bearing form — full payment reference,
 * BSB and account are included (the `report.ledger.export` capability is
 * the access control). Money renders as a plain decimal in CSV
 * (`centsToDecimal`) and as a numeric dollar value in xlsx so Excel can
 * sum it. One column definition drives both so they never drift.
 */

type TextCol = { header: string; text: (r: LedgerRow) => string | number | null };
type CentsCol = { header: string; cents: (r: LedgerRow) => number | null };
type Column = TextCol | CentsCol;

const ymd = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '');
const iso = (d: Date | null): string => (d ? d.toISOString() : '');
const yn = (b: boolean | null): string => (b === null ? '' : b ? 'yes' : 'no');

const COLUMNS: Column[] = [
  { header: 'Direction', text: (r) => r.direction },
  { header: 'Source type', text: (r) => r.sourceType },
  { header: 'Source ID', text: (r) => r.sourceId },
  { header: 'Reference', text: (r) => r.reference },
  { header: 'Counterparty', text: (r) => r.counterpartyName },
  { header: 'ABN', text: (r) => r.counterpartyAbn },
  { header: 'Project code', text: (r) => r.projectCode },
  { header: 'Client code', text: (r) => r.clientCode },
  { header: 'Internal code', text: (r) => r.internalCode },
  { header: 'Category', text: (r) => r.category },
  { header: 'Cost centre', text: (r) => r.costCentre },
  { header: 'Issue date', text: (r) => ymd(r.issueDate) },
  { header: 'Due date', text: (r) => ymd(r.dueDate) },
  { header: 'Paid date', text: (r) => ymd(r.paidDate) },
  { header: 'Ex-GST', cents: (r) => r.amountExGstCents },
  { header: 'GST', cents: (r) => r.gstCents },
  { header: 'Total', cents: (r) => r.amountTotalCents },
  { header: 'Paid amount', cents: (r) => r.amountPaidCents },
  { header: 'Currency', text: (r) => r.currency },
  { header: 'Status', text: (r) => r.status },
  { header: 'Xero ID', text: (r) => r.xeroId },
  { header: 'Payment reference', text: (r) => r.paymentReference },
  { header: 'BSB', text: (r) => r.paymentBsb },
  { header: 'Account', text: (r) => r.paymentAccount },
  { header: 'Rebillable', text: (r) => yn(r.rebillable) },
  { header: 'Rebilled on invoice', text: (r) => r.rebilledOnInvoiceId },
  { header: 'File URL', text: (r) => r.fileUrl },
  { header: 'Created at', text: (r) => iso(r.createdAt) },
  { header: 'Updated at', text: (r) => iso(r.updatedAt) },
  { header: 'Last audit action', text: (r) => r.lastAuditAction },
  { header: 'Last audit actor', text: (r) => r.lastAuditActorId },
  { header: 'Last audit at', text: (r) => iso(r.lastAuditAt) },
];

export const LEDGER_HEADER: string[] = COLUMNS.map((c) => c.header);

/** CSV cells: money as plain decimal strings (no float). */
function csvCells(r: LedgerRow): (string | number | null)[] {
  return COLUMNS.map((c) =>
    'cents' in c
      ? c.cents(r) === null
        ? ''
        : centsToDecimal(c.cents(r) as number)
      : c.text(r),
  );
}

/** xlsx cells: money as numeric dollar values so Excel can sum them. */
function xlsxCells(r: LedgerRow): WorkbookCell[] {
  return COLUMNS.map((c) =>
    'cents' in c
      ? c.cents(r) === null
        ? null
        : (c.cents(r) as number) / 100
      : c.text(r),
  );
}

export function ledgerToCsv(rows: LedgerRow[]): string {
  return toCsv(LEDGER_HEADER, rows.map(csvCells));
}

/**
 * Build the ledger workbook: All / Receivables (in) / Payables (out).
 * Empty direction slices still get a header-only sheet so the tab exists.
 */
export function ledgerToWorkbook(rows: LedgerRow[]): Buffer {
  const inRows = rows.filter((r) => r.direction === 'in');
  const outRows = rows.filter((r) => r.direction === 'out');
  return buildWorkbookBuffer([
    { name: 'All', header: LEDGER_HEADER, rows: rows.map(xlsxCells) },
    { name: 'Receivables (in)', header: LEDGER_HEADER, rows: inRows.map(xlsxCells) },
    { name: 'Payables (out)', header: LEDGER_HEADER, rows: outRows.map(xlsxCells) },
  ]);
}
