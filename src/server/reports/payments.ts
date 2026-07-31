import type { LedgerRow, LedgerSourceType } from '@/server/reports/ledger';

/**
 * Payments register helpers (TASK-069e). The register consolidates the
 * three operational, editable money flows — invoices (receivables),
 * bills (payables), expenses (reimbursables) — into one reviewable list,
 * so the operator no longer hops between `/receivables`, `/payables`,
 * `/reimbursables`. It reuses the master-ledger aggregation (TASK-069)
 * for data; these pure helpers add the payment-status lens and the
 * drill-through targets. All pure + exported for tests.
 */

/** The ledger source types that have an individual review/edit surface. */
export const EDITABLE_SOURCE_TYPES: readonly LedgerSourceType[] = [
  'invoice',
  'bill',
  'expense',
];

export function isEditablePaymentRow(row: LedgerRow): boolean {
  return (EDITABLE_SOURCE_TYPES as readonly string[]).includes(row.sourceType);
}

export type PaymentState = 'paid' | 'overdue' | 'outstanding';

// Statuses that mean the item is settled / closed — no longer owing.
const SETTLED_STATUSES = new Set([
  'paid',
  'written_off',
  'reimbursed',
  'rejected',
  'batched_for_payment',
]);

/**
 * Classify a row for the payment-status lens:
 *   paid        — settled status, or fully paid by amount
 *   overdue     — an 'overdue' status, or a past due date while unsettled
 *   outstanding — everything else still owing (incl. partial)
 */
export function paymentState(row: LedgerRow, today: Date = new Date()): PaymentState {
  if (row.status && SETTLED_STATUSES.has(row.status)) return 'paid';
  if (
    row.amountPaidCents !== null &&
    row.amountTotalCents > 0 &&
    row.amountPaidCents >= row.amountTotalCents
  ) {
    return 'paid';
  }
  if (row.status === 'overdue') return 'overdue';
  if (row.dueDate && row.dueDate.getTime() < today.getTime()) return 'overdue';
  return 'outstanding';
}

export function filterByPaymentState(
  rows: LedgerRow[],
  state: PaymentState | undefined,
  today: Date = new Date(),
): LedgerRow[] {
  if (!state) return rows;
  return rows.filter((r) => paymentState(r, today) === state);
}

/** The record's review/edit surface, or null for non-editable rows. */
export function paymentEditHref(row: LedgerRow): string | null {
  switch (row.sourceType) {
    case 'invoice':
      return `/invoices/${row.sourceId}`;
    case 'bill':
      return `/bills/${row.sourceId}`;
    case 'expense':
      return `/expenses/${row.sourceId}`;
    default:
      return null;
  }
}

/** Parse the `pay` query param into a PaymentState (or undefined). */
export function parsePaymentState(v: string | undefined): PaymentState | undefined {
  return v === 'paid' || v === 'overdue' || v === 'outstanding' ? v : undefined;
}
