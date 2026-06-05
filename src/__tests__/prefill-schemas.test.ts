import { describe, it, expect } from 'vitest';
import {
  TimesheetPrefillSchema,
  ExpensePrefillSchema,
  BillPrefillSchema,
  InvoicePrefillSchema,
} from '@/server/agents/assistant/prefill/schemas';

describe('TimesheetPrefillSchema', () => {
  it('accepts a minimal valid entry', () => {
    const r = TimesheetPrefillSchema.safeParse({
      entries: [{ projectCode: 'CAC001', dateIso: '2026-06-04', hours: 3 }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects an empty entries array', () => {
    const r = TimesheetPrefillSchema.safeParse({ entries: [] });
    expect(r.success).toBe(false);
  });
  it('rejects hours > 24', () => {
    const r = TimesheetPrefillSchema.safeParse({
      entries: [{ projectCode: 'CAC001', dateIso: '2026-06-04', hours: 25 }],
    });
    expect(r.success).toBe(false);
  });
  it('rejects malformed ISO date', () => {
    const r = TimesheetPrefillSchema.safeParse({
      entries: [{ projectCode: 'CAC001', dateIso: '04/06/2026', hours: 3 }],
    });
    expect(r.success).toBe(false);
  });
  it('rejects > 10 entries', () => {
    const r = TimesheetPrefillSchema.safeParse({
      entries: Array.from({ length: 11 }, (_, i) => ({
        projectCode: `P${i}`,
        dateIso: '2026-06-04',
        hours: 1,
      })),
    });
    expect(r.success).toBe(false);
  });
});

describe('ExpensePrefillSchema', () => {
  const valid = {
    dateIso: '2026-06-04',
    amountDollars: 48.5,
    category: 'computer_equipment',
    description: 'Monitor cable',
  };
  it('accepts a valid payload', () => {
    expect(ExpensePrefillSchema.safeParse(valid).success).toBe(true);
  });
  it('requires a description', () => {
    const r = ExpensePrefillSchema.safeParse({ ...valid, description: '' });
    expect(r.success).toBe(false);
  });
  it('requires positive amount', () => {
    const r = ExpensePrefillSchema.safeParse({ ...valid, amountDollars: 0 });
    expect(r.success).toBe(false);
  });
  it('accepts optional vendor + projectCode', () => {
    const r = ExpensePrefillSchema.safeParse({
      ...valid,
      vendor: 'Officeworks',
      projectCode: 'CAC001',
    });
    expect(r.success).toBe(true);
  });
});

describe('BillPrefillSchema', () => {
  const valid = {
    supplierName: 'Acme Ltd',
    supplierInvoiceNumber: 'INV-1',
    issueDateIso: '2026-06-04',
    dueDateIso: '2026-06-18',
    amountDollars: 1200,
    category: 'professional_fees',
  };
  it('accepts a valid payload', () => {
    expect(BillPrefillSchema.safeParse(valid).success).toBe(true);
  });
  it('requires supplierName', () => {
    const r = BillPrefillSchema.safeParse({ ...valid, supplierName: '' });
    expect(r.success).toBe(false);
  });
  it('requires due date in ISO', () => {
    const r = BillPrefillSchema.safeParse({ ...valid, dueDateIso: 'soon' });
    expect(r.success).toBe(false);
  });
});

describe('InvoicePrefillSchema', () => {
  it('accepts 1–20 lines', () => {
    const r = InvoicePrefillSchema.safeParse({
      projectCode: 'CAC001',
      lines: [{ label: 'Discovery', amountDollars: 30_000 }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects empty lines', () => {
    const r = InvoicePrefillSchema.safeParse({
      projectCode: 'CAC001',
      lines: [],
    });
    expect(r.success).toBe(false);
  });
  it('rejects > 20 lines', () => {
    const r = InvoicePrefillSchema.safeParse({
      projectCode: 'CAC001',
      lines: Array.from({ length: 21 }, (_, i) => ({
        label: `L${i}`,
        amountDollars: 100,
      })),
    });
    expect(r.success).toBe(false);
  });
});
