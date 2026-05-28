import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeBalanceSheet } from '@/server/reports/balance-sheet';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function parseAsOf(raw: string | undefined): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Operational balance-sheet view.
 *
 * Reads from Foundry's working-state data (Invoice / Bill /
 * BankTransaction / TimesheetEntry). NOT a substitute for Xero's
 * formal balance sheet — surface a banner at the top making this
 * clear so anyone reading it doesn't mistake it for ATO-ready
 * reporting.
 *
 * Access: partner-tier+. Mirrors the P&L surface — same audience
 * needs both signals to manage the firm.
 */
export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: { asOf?: string };
}) {
  const session = await getSession();
  if (
    !hasAnyRole(session, [
      'super_admin',
      'admin',
      'partner',
      'associate_partner',
    ])
  )
    notFound();

  const asOf = parseAsOf(searchParams.asOf);
  const isToday =
    new Date(asOf).toDateString() === new Date().toDateString();
  const bs = await computeBalanceSheet(asOf);

  const totalCheck = bs.assets.total - bs.liabilities.total - bs.equity.netPosition;
  // Should always be 0 by construction (equity = assets − liabilities).
  // Surface a tiny diagnostic if it's off — would indicate a code bug.

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Balance sheet</h1>
          <p className="text-sm text-ink-3">
            Operational snapshot as of{' '}
            <strong>{bs.asOf.toLocaleDateString('en-AU')}</strong>
            {isToday && <span className="ml-1 text-ink-4">· today</span>}.
            Foundry working-state — see caveat below.
          </p>
        </div>
        <form action="/balance-sheet" method="get" className="flex items-center gap-2">
          <label className="text-xs text-ink-3">As of</label>
          <input
            type="date"
            name="asOf"
            defaultValue={bs.asOf.toISOString().slice(0, 10)}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          />
          <button
            type="submit"
            className="rounded-md border border-line bg-card px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            View
          </button>
        </form>
      </header>

      <div className="rounded-md border border-status-amber bg-status-amber-soft/30 px-3 py-2 text-xs text-status-amber">
        <strong>Not a substitute for Xero.</strong> This view is computed
        from Foundry&apos;s working data (invoices / bills / timesheets /
        bank feed). Use it for &ldquo;where are we right now&rdquo; ops
        decisions. The official balance sheet for ATO / audit / BAS
        purposes lives in Xero — open the Xero Balance Sheet report for
        that. Numbers will differ because Foundry tracks accruals
        differently (e.g. WIP isn&apos;t in Xero until billed; GST split
        is approximate; equity isn&apos;t broken into contributed vs
        retained).
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Assets */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Assets</span>
              <Badge variant="green" className="text-xs">
                {formatMoney(bs.assets.total)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <BalanceRow
              label="Bank"
              value={bs.assets.bank}
              detail={`${bs.detail.bankTxnCount} txns`}
              href="/receivables"
            />
            <BalanceRow
              label="Accounts receivable"
              value={bs.assets.accountsReceivable}
              detail={`${bs.detail.arInvoiceCount} unpaid invoices`}
              href="/receivables"
            />
            <BalanceRow
              label="Work in progress"
              value={bs.assets.wip}
              detail={`${bs.detail.wipPersonCount} people · approved & unbilled hrs`}
              href="/timesheet"
            />
            <Divider />
            <BalanceRow
              label="Total assets"
              value={bs.assets.total}
              bold
            />
          </CardContent>
        </Card>

        {/* Liabilities */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Liabilities</span>
              <Badge variant="amber" className="text-xs">
                {formatMoney(bs.liabilities.total)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <BalanceRow
              label="Accounts payable"
              value={bs.liabilities.accountsPayable}
              detail={`${bs.detail.apBillCount} unpaid bills`}
              href="/payables"
            />
            <BalanceRow
              label="GST on AR (held in trust)"
              value={bs.liabilities.gstOnAR}
              detail="≈ AR ÷ 11 — verify against Xero BAS"
            />
            <Divider />
            <BalanceRow
              label="Total liabilities"
              value={bs.liabilities.total}
              bold
            />
          </CardContent>
        </Card>

        {/* Equity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Equity</span>
              <Badge
                variant={bs.equity.netPosition >= 0 ? 'blue' : 'red'}
                className="text-xs"
              >
                {formatMoney(bs.equity.netPosition)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <BalanceRow
              label="Net position"
              value={bs.equity.netPosition}
              detail="Assets − Liabilities"
              bold
            />
            <p className="mt-3 text-[11px] text-ink-3">
              The formal split into contributed capital + retained
              earnings lives in Xero. This is the operational net —
              what Foundry would hold if every AR cleared + every AP
              settled + every WIP hour billed today.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Grand-total strip */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
          <SummaryTile
            label="Total assets"
            value={formatMoney(bs.assets.total)}
            tone="green"
          />
          <SummaryTile
            label="Total liabilities"
            value={formatMoney(bs.liabilities.total)}
            tone="amber"
          />
          <SummaryTile
            label="Net position"
            value={formatMoney(bs.equity.netPosition)}
            tone={bs.equity.netPosition >= 0 ? 'blue' : 'red'}
          />
        </CardContent>
      </Card>

      {Math.abs(totalCheck) > 1 && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-xs text-status-red">
          ⚠ Identity check failed: assets − liabilities − equity ={' '}
          {formatMoney(totalCheck)}. This should be $0 by construction
          — surface to a developer.
        </div>
      )}

      <p className="text-[11px] text-ink-3">
        Tip: change the &ldquo;As of&rdquo; date above to view a
        point-in-time snapshot (e.g.{' '}
        <Link
          href="/balance-sheet?asOf=2026-06-30"
          className="text-brand hover:underline"
        >
          30 June 2026
        </Link>
        {' '}— EOFY).
      </p>
    </div>
  );
}

function BalanceRow({
  label,
  value,
  detail,
  href,
  bold,
}: {
  label: string;
  value: number;
  detail?: string;
  href?: string;
  bold?: boolean;
}) {
  const labelEl = (
    <span className={bold ? 'font-semibold text-ink' : 'text-ink-2'}>
      {label}
    </span>
  );
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="hover:text-brand hover:underline">
            {labelEl}
          </Link>
        ) : (
          labelEl
        )}
        {detail && (
          <div className="text-[11px] text-ink-3">{detail}</div>
        )}
      </div>
      <span
        className={`tabular-nums ${bold ? 'font-semibold text-ink' : 'text-ink'}`}
      >
        {formatMoney(value)}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-line" />;
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'green' | 'amber' | 'blue' | 'red';
}) {
  const toneColor =
    tone === 'green'
      ? 'text-status-green'
      : tone === 'amber'
        ? 'text-status-amber'
        : tone === 'red'
          ? 'text-status-red'
          : 'text-status-blue';
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneColor}`}>
        {value}
      </div>
    </div>
  );
}
