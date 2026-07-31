import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { buildLedger, type LedgerSourceType } from '@/server/reports/ledger';
import { parseLedgerFilters } from '@/server/reports/ledger-filters';
import {
  EDITABLE_SOURCE_TYPES,
  paymentState,
  filterByPaymentState,
  paymentEditHref,
  parsePaymentState,
  type PaymentState,
} from '@/server/reports/payments';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

function money(cents: number | null): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const ymd = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : '—');

const SOURCE_LABEL: Record<'invoice' | 'bill' | 'expense', string> = {
  invoice: 'Receivable',
  bill: 'Payable',
  expense: 'Reimbursable',
};

const STATE_BADGE: Record<PaymentState, 'green' | 'red' | 'amber'> = {
  paid: 'green',
  overdue: 'red',
  outstanding: 'amber',
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'report.ledger.view')) notFound();

  // Reuse the ledger aggregation, restricted to the three editable
  // operational flows (invoices / bills / expenses). If the user picks a
  // specific type, intersect with that.
  const base = parseLedgerFilters(searchParams);
  const requested = base.sourceTypes?.filter((t) =>
    (EDITABLE_SOURCE_TYPES as readonly string[]).includes(t),
  );
  const sourceTypes: LedgerSourceType[] =
    requested && requested.length
      ? requested
      : [...EDITABLE_SOURCE_TYPES];

  const rows = await buildLedger(session, { ...base, sourceTypes });

  const cur = (k: string): string => {
    const v = searchParams[k];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  const payState = parsePaymentState(cur('pay') || undefined);
  const now = new Date();
  const visible = filterByPaymentState(rows, payState, now);

  const counts = {
    outstanding: rows.filter((r) => paymentState(r, now) === 'outstanding').length,
    overdue: rows.filter((r) => paymentState(r, now) === 'overdue').length,
    paid: rows.filter((r) => paymentState(r, now) === 'paid').length,
  };

  const hasFilters = Boolean(
    payState || base.direction || base.sourceTypes || base.status || base.from || base.to,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Payments</h1>
        <p className="max-w-2xl text-sm text-ink-3">
          Every inbound and outbound item in one place — receivables,
          payables and reimbursables — with its payment status. Click any
          row to review or edit the underlying record.
        </p>
      </header>

      {/* Payment-status lens */}
      <div className="flex flex-wrap gap-2">
        <LensLink cur={cur} value="" label={`All (${rows.length})`} active={!payState} />
        <LensLink cur={cur} value="outstanding" label={`Outstanding (${counts.outstanding})`} active={payState === 'outstanding'} />
        <LensLink cur={cur} value="overdue" label={`Overdue (${counts.overdue})`} active={payState === 'overdue'} />
        <LensLink cur={cur} value="paid" label={`Paid (${counts.paid})`} active={payState === 'paid'} />
      </div>

      {/* Direction / type / date filters */}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card p-3">
        {payState && <input type="hidden" name="pay" value={payState} />}
        <Field label="Direction">
          <select name="direction" defaultValue={cur('direction')} className={selectCls}>
            <option value="">All</option>
            <option value="in">In (receivable)</option>
            <option value="out">Out (payable)</option>
          </select>
        </Field>
        <Field label="Type">
          <select name="sourceType" defaultValue={cur('sourceType')} className={selectCls}>
            <option value="">All</option>
            <option value="invoice">Receivable</option>
            <option value="bill">Payable</option>
            <option value="expense">Reimbursable</option>
          </select>
        </Field>
        <Field label="From">
          <input type="date" name="from" defaultValue={cur('from')} className={selectCls} />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={cur('to')} className={selectCls} />
        </Field>
        <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand/90">
          Apply
        </button>
        {hasFilters && (
          <a href="/payments" className="px-2 py-1.5 text-sm text-ink-3 underline">
            Reset
          </a>
        )}
      </form>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card px-6 py-16 text-center">
          <p className="text-sm font-medium text-ink-2">No payments match</p>
          <p className="mt-1 text-sm text-ink-3">
            {hasFilters ? 'Try widening the filters, or reset.' : 'Once invoices, bills or expenses exist they appear here.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <Table className="min-w-[1100px] text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Dir</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => {
                const state = paymentState(r, now);
                const href = paymentEditHref(r);
                return (
                  <TableRow key={`${r.sourceType}:${r.sourceId}`}>
                    <TableCell>
                      <Badge variant={r.direction === 'in' ? 'green' : 'red'}>
                        {r.direction === 'in' ? 'In' : 'Out'}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {SOURCE_LABEL[r.sourceType as 'invoice' | 'bill' | 'expense']}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.reference ?? '—'}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">{r.counterpartyName ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.projectCode ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{ymd(r.issueDate)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{ymd(r.dueDate)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(r.amountTotalCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.amountPaidCents)}</TableCell>
                    <TableCell>
                      <Badge variant={STATE_BADGE[state]} className="capitalize">
                        {state}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {href ? (
                        <Link href={href} className="text-brand underline hover:text-brand/80">
                          Review / edit →
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

const selectCls = 'rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-3">{label}</span>
      {children}
    </label>
  );
}

/** A payment-status lens chip that preserves the other filters via the URL. */
function LensLink({
  cur,
  value,
  label,
  active,
}: {
  cur: (k: string) => string;
  value: string;
  label: string;
  active: boolean;
}) {
  const params = new URLSearchParams();
  for (const k of ['direction', 'sourceType', 'from', 'to'] as const) {
    if (cur(k)) params.set(k, cur(k));
  }
  if (value) params.set('pay', value);
  const q = params.toString();
  return (
    <Link
      href={`/payments${q ? `?${q}` : ''}`}
      className={`rounded-full border px-3 py-1 text-xs ${
        active
          ? 'border-brand bg-brand/10 text-brand'
          : 'border-line bg-card text-ink-2 hover:bg-surface-hover'
      }`}
    >
      {label}
    </Link>
  );
}
