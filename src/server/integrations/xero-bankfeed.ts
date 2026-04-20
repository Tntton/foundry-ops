import { prisma } from '@/server/db';
import { xeroRequest } from '@/server/integrations/xero';

// How far back to ask Xero for transactions on each nightly pull. Xero returns
// all matching rows; we dedupe on xeroTxnId so overlap is safe.
const LOOKBACK_DAYS = 30;

type RawBankTransaction = {
  BankTransactionID: string;
  Type: 'SPEND' | 'RECEIVE' | 'SPEND-TRANSFER' | 'RECEIVE-TRANSFER';
  Date: string; // "/Date(1712345678000+0000)/"
  Status?: string;
  IsReconciled?: boolean;
  Reference?: string;
  Contact?: { Name?: string };
  Total: number; // decimal; sign depends on Type
  LineItems?: Array<{ Description?: string }>;
};

type ListResponse = {
  BankTransactions: RawBankTransaction[];
};

/**
 * Xero serialises Date as "/Date(ms+offset)/". Strip offset + parse.
 */
export function parseXeroDate(s: string): Date {
  const m = s.match(/\/Date\((\d+)([+-]\d{4})?\)\//);
  if (!m) throw new Error(`Invalid Xero date format: ${s}`);
  return new Date(Number(m[1]));
}

/**
 * Xero's `Total` is unsigned; the sign is implied by `Type`. Foundry stores
 * amounts signed (positive = money in, negative = money out) so reconciler
 * agents can compare against the invoice / bill totals directly.
 */
export function signedAmountCents(type: RawBankTransaction['Type'], total: number): number {
  const signed = type.startsWith('SPEND') ? -total : total;
  return Math.round(signed * 100);
}

/**
 * Pull bank transactions from Xero for the last LOOKBACK_DAYS days and upsert
 * into the BankTransaction table. Idempotent on xeroTxnId — overlapping pulls
 * are safe. Returns counts for logging.
 */
export async function pullBankTransactions(): Promise<{
  fetched: number;
  inserted: number;
  updated: number;
}> {
  const sinceDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const y = sinceDate.getUTCFullYear();
  const mo = sinceDate.getUTCMonth() + 1;
  const d = sinceDate.getUTCDate();
  const whereClause = `Date>=DateTime(${y},${String(mo).padStart(2, '0')},${String(d).padStart(2, '0')})`;

  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let page = 1;

  // Xero returns up to 100 per page; loop until an empty page.
  while (true) {
    const query = `?where=${encodeURIComponent(whereClause)}&page=${page}`;
    const res = await xeroRequest<ListResponse>(
      'GET',
      `/api.xro/2.0/BankTransactions${query}`,
    );
    const rows = res.BankTransactions ?? [];
    if (rows.length === 0) break;
    fetched += rows.length;

    for (const row of rows) {
      const amountCents = signedAmountCents(row.Type, row.Total);
      const description =
        row.Reference ??
        row.LineItems?.[0]?.Description ??
        row.Contact?.Name ??
        null;

      const existing = await prisma.bankTransaction.findUnique({
        where: { xeroTxnId: row.BankTransactionID },
        select: { id: true },
      });

      await prisma.bankTransaction.upsert({
        where: { xeroTxnId: row.BankTransactionID },
        update: {
          date: parseXeroDate(row.Date),
          amount: amountCents,
          description,
          rawPayload: row as unknown as object,
        },
        create: {
          xeroTxnId: row.BankTransactionID,
          date: parseXeroDate(row.Date),
          amount: amountCents,
          description,
          rawPayload: row as unknown as object,
        },
      });

      if (existing) updated++;
      else inserted++;
    }

    if (rows.length < 100) break;
    page++;
  }

  return { fetched, inserted, updated };
}
