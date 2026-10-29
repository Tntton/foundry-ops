import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { buildLedger, type LedgerRow } from '@/server/reports/ledger';
import {
  parseLedgerFilters,
  ledgerFiltersToQuery,
} from '@/server/reports/ledger-filters';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { OpenIn365 } from '@/components/sharepoint-link';
import { LedgerBackupButton } from './backup-button';

export const dynamic = 'force-dynamic';

function money(cents: number | null): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '—';
}

/** Mask a bank BSB / account so only the last 3 digits show on-screen.
 *  Full values are only ever emitted through the gated export. */
function maskTail(v: string | null): string {
  if (!v) return '—';
  const digits = v.replace(/\D/gu, '');
  if (digits.length <= 3) return `•••${digits}`;
  return `•••${digits.slice(-3)}`;
}

const SOURCE_LABEL: Record<LedgerRow['sourceType'], string> = {
  invoice: 'Invoice',
  bill: 'Bill',
  expense: 'Expense',
  payrun_line: 'Pay run',
  contractor_invoice: 'Contractor',
  bank_transaction: 'Bank',
};

const SOURCE_OPTIONS = Object.entries(SOURCE_LABEL) as [
  LedgerRow['sourceType'],
  string,
][];

export default async function MasterLedgerPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'report.ledger.view')) notFound();

  const filters = parseLedgerFilters(searchParams);
  const rows = await buildLedger(session, filters);
  const query = ledgerFiltersToQuery(searchParams);
  const canExport = hasCapability(session, 'report.ledger.export');

  const totalIn = rows
    .filter((r) => r.direction === 'in')
    .reduce((s, r) => s + r.amountTotalCents, 0);
  const totalOut = rows
    .filter((r) => r.direction === 'out')
    .reduce((s, r) => s + r.amountTotalCents, 0);

  const cur = (k: string): string => {
    const v = searchParams[k];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Master ledger</h1>
          <p className="max-w-2xl text-sm text-ink-3">
            Every payable and receivable in and out — invoices, bills,
            expenses, pay runs, contractor invoices and the bank feed — in one
            audit-grade sheet. Live from the database. Bank account details are
            masked here; the export carries full payment references.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/reports/ledger${query ? `${query}&` : '?'}format=csv`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Export CSV
          </a>
          <a
            href={`/api/reports/ledger${query ? `${query}&` : '?'}format=xlsx`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Export Excel
          </a>
          {canExport && <LedgerBackupButton />}
        </div>
      </header>

      {/* Filters — GET form so the URL is shareable + the export links
          inherit the same scope. */}
      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card p-3"
      >
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
            {SOURCE_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <input
            type="text"
            name="status"
            defaultValue={cur('status')}
            placeholder="e.g. paid"
            className={selectCls}
          />
        </Field>
        <Field label="From">
          <input type="date" name="from" defaultValue={cur('from')} className={selectCls} />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={cur('to')} className={selectCls} />
        </Field>
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand/90"
        >
          Apply
        </button>
        {query && (
          <a href="/reports/ledger" className="px-2 py-1.5 text-sm text-ink-3 underline">
            Reset
          </a>
        )}
      </form>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Money in" value={money(totalIn)} tone="green" />
        <SummaryCard label="Money out" value={money(totalOut)} tone="red" />
        <SummaryCard label="Rows" value={String(rows.length)} tone="neutral" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card px-6 py-16 text-center">
          <p className="text-sm font-medium text-ink-2">No ledger rows match</p>
          <p className="mt-1 text-sm text-ink-3">
            {query
              ? 'Try widening the filters, or reset to see the full ledger.'
              : 'Once invoices, bills, expenses or pay runs exist they appear here.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <Table className="min-w-[1400px] text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Dir</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>ABN</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Internal</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Ex-GST</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Xero</TableHead>
                <TableHead>Pay ref</TableHead>
                <TableHead>BSB</TableHead>
                <TableHead>Acct</TableHead>
                <TableHead>File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.sourceType}:${r.sourceId}`}>
                  <TableCell className="whitespace-nowrap tabular-nums">{ymd(r.issueDate)}</TableCell>
                  <TableCell>
                    <Badge variant={r.direction === 'in' ? 'green' : 'red'}>
                      {r.direction === 'in' ? 'In' : 'Out'}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{SOURCE_LABEL[r.sourceType]}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.reference ?? '—'}</TableCell>
                  <TableCell className="max-w-[16rem] truncate">{r.counterpartyName ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{r.counterpartyAbn ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.projectCode ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.clientCode ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.internalCode ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.category ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.amountExGstCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.gstCents)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{money(r.amountTotalCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.amountPaidCents)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.status ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.xeroId ? '✓' : '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.paymentReference ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{maskTail(r.paymentBsb)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{maskTail(r.paymentAccount)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.fileUrl ? <OpenIn365 url={r.fileUrl} label="Open" /> : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

const selectCls =
  'rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-3">{label}</span>
      {children}
    </label>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'green' | 'red' | 'neutral';
}) {
  const toneCls =
    tone === 'green' ? 'text-status-green' : tone === 'red' ? 'text-status-red' : 'text-ink';
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}
