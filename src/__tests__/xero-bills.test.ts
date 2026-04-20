import { describe, it, expect } from 'vitest';
import { buildBillPayload } from '@/server/integrations/xero-bills';

describe('buildBillPayload (Xero ACCPAY bill body)', () => {
  const base = {
    supplier: { name: 'Atlassian' } as const,
    supplierInvoiceNumber: 'INV-ATL-88',
    issueDate: new Date('2026-04-01T00:00:00Z'),
    dueDate: new Date('2026-05-01T00:00:00Z'),
    amountTotalCents: 220_00, // $220 inc GST
    category: 'subscriptions',
    supplierLabel: 'Atlassian',
    projectCode: null,
    expenseAccountCode: null,
  };

  it('emits DRAFT ACCPAY with Inclusive line amounts', () => {
    const p = buildBillPayload(base);
    expect(p.Status).toBe('DRAFT');
    expect(p.Type).toBe('ACCPAY');
    expect(p.LineAmountTypes).toBe('Inclusive');
  });

  it('formats dates as YYYY-MM-DD', () => {
    const p = buildBillPayload(base);
    expect(p.Date).toBe('2026-04-01');
    expect(p.DueDate).toBe('2026-05-01');
  });

  it('passes supplier name when there is no xeroContactId', () => {
    const p = buildBillPayload(base);
    expect(p.Contact).toEqual({ Name: 'Atlassian' });
  });

  it('uses Xero ContactID when the supplier Person already has one', () => {
    const p = buildBillPayload({
      ...base,
      supplier: { xeroContactId: 'person-xc-123' },
    });
    expect(p.Contact).toEqual({ ContactID: 'person-xc-123' });
  });

  it('single line, Quantity=1, UnitAmount = total / 100', () => {
    const p = buildBillPayload(base);
    expect(p.LineItems).toHaveLength(1);
    expect(p.LineItems[0]?.Quantity).toBe(1);
    expect(p.LineItems[0]?.UnitAmount).toBe(220);
  });

  it('TaxType=INPUT so Xero treats the line as expense GST-inclusive', () => {
    const p = buildBillPayload(base);
    expect(p.LineItems[0]?.TaxType).toBe('INPUT');
  });

  it('humanises category in line description', () => {
    const p = buildBillPayload({ ...base, category: 'professional_services' });
    expect(p.LineItems[0]?.Description).toBe('Professional Services — Atlassian');
  });

  it('includes project tracking + Reference when projectCode present', () => {
    const p = buildBillPayload({ ...base, projectCode: 'IFM001' });
    expect(p.Reference).toBe('IFM001');
    expect(p.LineItems[0]?.Tracking).toEqual([{ Name: 'Projects', Option: 'IFM001' }]);
  });

  it('omits Tracking + Reference for OPEX (no project)', () => {
    const p = buildBillPayload(base);
    expect(p.Reference).toBeUndefined();
    expect(p.LineItems[0]?.Tracking).toBeUndefined();
  });

  it('adds AccountCode only when expenseAccountCode provided', () => {
    const p1 = buildBillPayload(base);
    expect(p1.LineItems[0]?.AccountCode).toBeUndefined();
    const p2 = buildBillPayload({ ...base, expenseAccountCode: '453' });
    expect(p2.LineItems[0]?.AccountCode).toBe('453');
  });

  it('passes supplierInvoiceNumber through as InvoiceNumber', () => {
    const p = buildBillPayload(base);
    expect(p.InvoiceNumber).toBe('INV-ATL-88');
  });

  it('omits InvoiceNumber when supplier did not provide one', () => {
    const p = buildBillPayload({ ...base, supplierInvoiceNumber: null });
    expect(p.InvoiceNumber).toBeUndefined();
  });
});
