import { describe, it, expect } from 'vitest';
import {
  decideDocRoute,
  parseDocChoice,
  DOC_ROUTE_CONFIDENCE_MIN,
} from '@/server/agents/intent/doc-route';

describe('decideDocRoute', () => {
  const hi = DOC_ROUTE_CONFIDENCE_MIN + 10;
  const lo = DOC_ROUTE_CONFIDENCE_MIN - 10;

  it('routes a confident supplier invoice to bill', () => {
    expect(
      decideDocRoute({ documentType: 'supplier_invoice', docConfidence: hi, caption: null }),
    ).toBe('bill');
  });
  it('routes a confident receipt to expense', () => {
    expect(
      decideDocRoute({ documentType: 'receipt', docConfidence: hi, caption: null }),
    ).toBe('expense');
  });
  it('clarifies when confidence is below the threshold', () => {
    expect(
      decideDocRoute({ documentType: 'supplier_invoice', docConfidence: lo, caption: null }),
    ).toBe('clarify');
  });
  it('clarifies on unknown / missing type', () => {
    expect(decideDocRoute({ documentType: 'unknown', docConfidence: hi, caption: null })).toBe('clarify');
    expect(decideDocRoute({ documentType: null, docConfidence: undefined, caption: null })).toBe('clarify');
  });
  it('caption keyword overrides the classifier', () => {
    // classifier says receipt, but caption says "invoice" → bill
    expect(
      decideDocRoute({ documentType: 'receipt', docConfidence: hi, caption: 'GNC002 supplier invoice' }),
    ).toBe('bill');
    // classifier unsure, caption says "receipt" → expense
    expect(
      decideDocRoute({ documentType: 'unknown', docConfidence: 0, caption: 'lunch receipt' }),
    ).toBe('expense');
  });
});

describe('parseDocChoice', () => {
  it('parses bill / invoice', () => {
    expect(parseDocChoice('BILL')).toBe('bill');
    expect(parseDocChoice('bill')).toBe('bill');
    expect(parseDocChoice('invoice')).toBe('bill');
    expect(parseDocChoice('bill it')).toBe('bill');
  });
  it('parses receipt', () => {
    expect(parseDocChoice('RECEIPT')).toBe('expense');
    expect(parseDocChoice('receipt please')).toBe('expense');
  });
  it('returns null for anything else', () => {
    expect(parseDocChoice('maybe?')).toBeNull();
    expect(parseDocChoice('')).toBeNull();
    expect(parseDocChoice(null)).toBeNull();
  });
});
