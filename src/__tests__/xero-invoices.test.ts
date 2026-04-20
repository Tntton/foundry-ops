import { describe, it, expect } from 'vitest';
import { buildInvoicePayload } from '@/server/integrations/xero-invoices';

describe('buildInvoicePayload (Xero ACCREC invoice body)', () => {
  const base = {
    invoiceNumber: 'IFM001-INV-12',
    issueDate: new Date('2026-04-20T00:00:00Z'),
    dueDate: new Date('2026-05-20T00:00:00Z'),
    projectCode: 'IFM001',
    contactId: 'xero-contact-abc',
    lineItems: [
      { label: 'Milestone 1', amountCents: 1_500_000 }, // $15,000 ex GST
      { label: 'T&M hours — Mar 2026', amountCents: 432_50 }, // $432.50 ex GST
    ],
  };

  it('formats dates as YYYY-MM-DD', () => {
    const p = buildInvoicePayload(base);
    expect(p.Date).toBe('2026-04-20');
    expect(p.DueDate).toBe('2026-05-20');
  });

  it('sets DRAFT status, ACCREC type, Exclusive line amounts', () => {
    const p = buildInvoicePayload(base);
    expect(p.Status).toBe('DRAFT');
    expect(p.Type).toBe('ACCREC');
    expect(p.LineAmountTypes).toBe('Exclusive');
  });

  it('passes the Xero contact ID through', () => {
    const p = buildInvoicePayload(base);
    expect(p.Contact.ContactID).toBe('xero-contact-abc');
  });

  it('converts integer cents to decimal AUD per line', () => {
    const p = buildInvoicePayload(base);
    expect(p.LineItems[0]?.UnitAmount).toBe(15_000);
    expect(p.LineItems[1]?.UnitAmount).toBe(432.5);
  });

  it('includes per-line tracking with project code as Option', () => {
    const p = buildInvoicePayload(base);
    expect(p.LineItems[0]?.Tracking).toEqual([{ Name: 'Projects', Option: 'IFM001' }]);
    expect(p.LineItems[1]?.Tracking).toEqual([{ Name: 'Projects', Option: 'IFM001' }]);
  });

  it('omits AccountCode when no sales account env is set', () => {
    const p = buildInvoicePayload(base);
    expect(p.LineItems[0]?.AccountCode).toBeUndefined();
  });

  it('includes AccountCode when sales account code is provided', () => {
    const p = buildInvoicePayload({ ...base, salesAccountCode: '200' });
    expect(p.LineItems[0]?.AccountCode).toBe('200');
    expect(p.LineItems[1]?.AccountCode).toBe('200');
  });

  it('uses project code as the Xero Reference field', () => {
    const p = buildInvoicePayload(base);
    expect(p.Reference).toBe('IFM001');
  });

  it('passes the invoice number straight through', () => {
    const p = buildInvoicePayload(base);
    expect(p.InvoiceNumber).toBe('IFM001-INV-12');
  });

  it('forces TaxType=OUTPUT on every line (AU GST default)', () => {
    const p = buildInvoicePayload(base);
    for (const l of p.LineItems) expect(l.TaxType).toBe('OUTPUT');
  });

  it('sets Quantity=1 on every line (dollar-denominated lines, not hours)', () => {
    const p = buildInvoicePayload(base);
    for (const l of p.LineItems) expect(l.Quantity).toBe(1);
  });
});
