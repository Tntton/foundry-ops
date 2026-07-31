import { describe, it, expect } from 'vitest';
import {
  paymentState,
  filterByPaymentState,
  paymentEditHref,
  isEditablePaymentRow,
  parsePaymentState,
} from '@/server/reports/payments';
import type { LedgerRow } from '@/server/reports/ledger';

/**
 * TASK-069e · payments register helpers — the payment-status lens and
 * the per-row review/edit drill-through targets.
 */

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  direction: 'in',
  sourceType: 'invoice',
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
  amountTotalCents: 10000,
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
  ...over,
});

const TODAY = new Date('2026-07-31T00:00:00Z');

describe('paymentState', () => {
  it('marks settled statuses as paid', () => {
    expect(paymentState(row({ status: 'paid' }), TODAY)).toBe('paid');
    expect(paymentState(row({ status: 'reimbursed' }), TODAY)).toBe('paid');
    expect(paymentState(row({ status: 'written_off' }), TODAY)).toBe('paid');
  });
  it('marks fully-paid-by-amount as paid even without a settled status', () => {
    expect(
      paymentState(row({ status: 'partial', amountTotalCents: 10000, amountPaidCents: 10000 }), TODAY),
    ).toBe('paid');
  });
  it('marks overdue status or a past due date as overdue', () => {
    expect(paymentState(row({ status: 'overdue' }), TODAY)).toBe('overdue');
    expect(paymentState(row({ status: 'approved', dueDate: new Date('2026-07-01') }), TODAY)).toBe('overdue');
  });
  it('marks a partially-paid, not-yet-due item as outstanding', () => {
    expect(
      paymentState(row({ status: 'partial', amountTotalCents: 10000, amountPaidCents: 4000, dueDate: new Date('2026-08-31') }), TODAY),
    ).toBe('outstanding');
  });
});

describe('filterByPaymentState', () => {
  it('filters to the requested state', () => {
    const rows = [
      row({ sourceId: 'a', status: 'paid' }),
      row({ sourceId: 'b', status: 'overdue' }),
      row({ sourceId: 'c', status: 'sent', dueDate: new Date('2026-09-01') }),
    ];
    expect(filterByPaymentState(rows, 'outstanding', TODAY).map((r) => r.sourceId)).toEqual(['c']);
  });
  it('passes through when no state given', () => {
    const rows = [row({ sourceId: 'a' })];
    expect(filterByPaymentState(rows, undefined, TODAY)).toHaveLength(1);
  });
});

describe('paymentEditHref', () => {
  it('routes each source type to its edit surface', () => {
    expect(paymentEditHref(row({ sourceType: 'invoice', sourceId: 'i1' }))).toBe('/invoices/i1');
    expect(paymentEditHref(row({ sourceType: 'bill', sourceId: 'b1' }))).toBe('/bills/b1');
    expect(paymentEditHref(row({ sourceType: 'expense', sourceId: 'e1' }))).toBe('/expenses/e1');
    expect(paymentEditHref(row({ sourceType: 'bank_transaction', sourceId: 't1' }))).toBeNull();
  });
});

describe('isEditablePaymentRow + parsePaymentState', () => {
  it('recognises the three editable source types', () => {
    expect(isEditablePaymentRow(row({ sourceType: 'invoice' }))).toBe(true);
    expect(isEditablePaymentRow(row({ sourceType: 'payrun_line' }))).toBe(false);
  });
  it('parses only valid payment states', () => {
    expect(parsePaymentState('overdue')).toBe('overdue');
    expect(parsePaymentState('nope')).toBeUndefined();
    expect(parsePaymentState(undefined)).toBeUndefined();
  });
});
