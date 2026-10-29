import { describe, it, expect } from 'vitest';
import { invoiceRevenueByProject } from '@/server/invoice-attribution';

describe('invoiceRevenueByProject', () => {
  it('attributes the whole header amount to the header project when there are no lines', () => {
    const out = invoiceRevenueByProject({
      projectId: 'p_head',
      amountExGst: 50_000,
      lineItems: [],
    });
    expect(out).toEqual([{ projectId: 'p_head', amountExGstCents: 50_000 }]);
  });

  it('single-project invoice → one contribution equal to the header total', () => {
    const out = invoiceRevenueByProject({
      projectId: 'p_head',
      amountExGst: 30_000,
      lineItems: [
        { projectId: null, amount: 20_000 },
        { projectId: null, amount: 10_000 },
      ],
    });
    expect(out).toEqual([{ projectId: 'p_head', amountExGstCents: 30_000 }]);
  });

  it('splits across line projects, header fallback for null lines', () => {
    const out = invoiceRevenueByProject({
      projectId: 'p_head',
      amountExGst: 100_000,
      lineItems: [
        { projectId: null, amount: 40_000 }, // → header
        { projectId: 'p_sibling', amount: 35_000 },
        { projectId: 'p_head', amount: 25_000 }, // explicit header
      ],
    });
    const byId = Object.fromEntries(
      out.map((c) => [c.projectId, c.amountExGstCents]),
    );
    expect(byId['p_head']).toBe(65_000); // 40k null + 25k explicit
    expect(byId['p_sibling']).toBe(35_000);
    expect(out.reduce((s, c) => s + c.amountExGstCents, 0)).toBe(100_000);
  });

  it('reconciles drift between line sum and header total onto the header project', () => {
    const out = invoiceRevenueByProject({
      projectId: 'p_head',
      amountExGst: 100_000, // header says 100k
      lineItems: [{ projectId: 'p_sibling', amount: 90_000 }], // lines only 90k
    });
    const byId = Object.fromEntries(
      out.map((c) => [c.projectId, c.amountExGstCents]),
    );
    expect(byId['p_sibling']).toBe(90_000);
    expect(byId['p_head']).toBe(10_000); // drift pushed to header
    expect(out.reduce((s, c) => s + c.amountExGstCents, 0)).toBe(100_000);
  });

  it('contributions always sum to the header amountExGst', () => {
    const out = invoiceRevenueByProject({
      projectId: 'p_head',
      amountExGst: 77_777,
      lineItems: [
        { projectId: 'a', amount: 11_111 },
        { projectId: 'b', amount: 22_222 },
        { projectId: null, amount: 44_444 },
      ],
    });
    expect(out.reduce((s, c) => s + c.amountExGstCents, 0)).toBe(77_777);
  });
});
