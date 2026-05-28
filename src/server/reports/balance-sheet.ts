import { prisma } from '@/server/db';

/**
 * Operational balance-sheet view.
 *
 * ⚠️  NOT a substitute for Xero's official balance sheet. This is a
 * working-state snapshot computed from Foundry's transactional data
 * — useful for "what's our position right now" but NOT for ATO /
 * audit reporting. Xero is the canonical source of truth for the
 * formal balance sheet (per locked decision A1 — DB is authoritative
 * for ops, Xero is authoritative for accounting).
 *
 * Scope of computation:
 *   - **Assets**:
 *       - Bank (from BankTransaction.amount sum — signed)
 *       - Accounts Receivable (Invoice.amountTotal − paymentReceived
 *         for invoices in sent / partial / overdue status)
 *       - Work in Progress (approved-but-unbilled TimesheetEntry
 *         hours × person bill rate)
 *   - **Liabilities**:
 *       - Accounts Payable (Bill.amountTotal for bills in approved
 *         / scheduled_for_payment status — not yet paid)
 *       - GST collected on AR (10% portion of AR — money the firm
 *         holds in trust for the ATO until paid)
 *   - **Equity**:
 *       - Derived (Assets − Liabilities) — the "net position" the
 *         firm currently holds. Not split into contributed capital
 *         vs retained earnings because the working data doesn't
 *         carry the distinction.
 *
 * `asOf` lets the caller render a point-in-time snapshot
 * (e.g. EOFY 30/06/2026). Defaults to "now" for the live view.
 */

export type BalanceSheet = {
  asOf: Date;
  assets: {
    bank: number;            // AUD cents
    accountsReceivable: number;
    wip: number;
    total: number;
  };
  liabilities: {
    accountsPayable: number;
    gstOnAR: number;         // GST liability sitting inside the AR receivable
    total: number;
  };
  equity: {
    /** Derived = Assets − Liabilities. NOT contributed-capital +
     *  retained-earnings — that split needs the formal accounting
     *  in Xero. We just surface the operational net position. */
    netPosition: number;
  };
  /** Per-line drill-down counts so the UI can render "12 unpaid
   *  invoices · $XXX,XXX" rather than just a number. */
  detail: {
    arInvoiceCount: number;
    apBillCount: number;
    wipPersonCount: number;
    bankTxnCount: number;
  };
};

/**
 * Bill rate fallback when the Person hasn't set one explicitly.
 * Conservative default — used only to keep WIP from going to $0 for
 * staff with missing billRate; admin should fix the Person row.
 */
const DEFAULT_HOURLY_BILL_RATE_CENTS = 25000; // $250/hr placeholder

export async function computeBalanceSheet(
  asOf: Date = new Date(),
): Promise<BalanceSheet> {
  // ── Assets ────────────────────────────────────────────────────

  // 1. Bank — sum of all matched + unmatched BankTransactions up to
  //    the asOf cutoff. Signed amounts; a debit is negative.
  const bankAgg = await prisma.bankTransaction.aggregate({
    where: { date: { lte: asOf } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const bank = bankAgg._sum.amount ?? 0;

  // 2. Accounts Receivable — invoices that have been sent (or are
  //    overdue / partially paid) where money is still outstanding.
  //    Excludes paid + written_off + draft + pending_approval.
  const arInvoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['sent', 'partial', 'overdue'] },
      issueDate: { lte: asOf },
    },
    select: { amountTotal: true, paymentReceivedAmount: true },
  });
  let accountsReceivable = 0;
  for (const i of arInvoices) {
    accountsReceivable += i.amountTotal - (i.paymentReceivedAmount ?? 0);
  }

  // 3. Work In Progress — timesheet entries that have been approved
  //    but not yet billed (no billedInvoiceId). Valued at the
  //    person's bill rate (or fallback). Real billing happens
  //    project-by-project, so this is a rough firm-wide WIP estimate.
  const unbilled = await prisma.timesheetEntry.findMany({
    where: {
      status: 'approved',
      billedInvoiceId: null,
      date: { lte: asOf },
    },
    select: {
      hours: true,
      person: { select: { id: true, billRate: true, rateUnit: true } },
    },
  });
  const wipPersonIds = new Set<string>();
  let wip = 0;
  for (const t of unbilled) {
    wipPersonIds.add(t.person.id);
    const hours = Number(t.hours);
    // billRate is stored in cents per `rateUnit` (hour | day). Day
    // rate / 8 ≈ hourly. Same logic as the timesheet page.
    const hourlyRateCents =
      t.person.billRate && t.person.billRate > 0
        ? t.person.rateUnit === 'day'
          ? Math.round(t.person.billRate / 8)
          : t.person.billRate
        : DEFAULT_HOURLY_BILL_RATE_CENTS;
    wip += Math.round(hours * hourlyRateCents);
  }

  const totalAssets = bank + accountsReceivable + wip;

  // ── Liabilities ───────────────────────────────────────────────

  // 1. Accounts Payable — bills approved or scheduled, not yet paid.
  const apBills = await prisma.bill.findMany({
    where: {
      status: { in: ['approved', 'scheduled_for_payment'] },
      issueDate: { lte: asOf },
    },
    select: { amountTotal: true },
  });
  const accountsPayable = apBills.reduce((s, b) => s + b.amountTotal, 0);

  // 2. GST on AR — the 10% GST portion baked into the AR receivable
  //    is a liability to the ATO (collected from clients, owed to
  //    the tax office). Rough computation: AR includes GST, so the
  //    GST component is AR × (1/11). This is an approximation —
  //    actual GST liability depends on the BAS cycle + cash vs
  //    accrual basis. Xero is canonical for the BAS figure.
  const gstOnAR = Math.round(accountsReceivable / 11);

  const totalLiabilities = accountsPayable + gstOnAR;

  // ── Equity ────────────────────────────────────────────────────
  const netPosition = totalAssets - totalLiabilities;

  return {
    asOf,
    assets: {
      bank,
      accountsReceivable,
      wip,
      total: totalAssets,
    },
    liabilities: {
      accountsPayable,
      gstOnAR,
      total: totalLiabilities,
    },
    equity: { netPosition },
    detail: {
      arInvoiceCount: arInvoices.length,
      apBillCount: apBills.length,
      wipPersonCount: wipPersonIds.size,
      bankTxnCount: bankAgg._count._all,
    },
  };
}
