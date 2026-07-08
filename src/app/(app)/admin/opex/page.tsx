import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeOpexTracker, fyMonthLabel } from '@/server/reports/opex-tracker';
import { auFyOf, auFyLabel } from '@/lib/au-fy';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// FY tabs re-query per selection — same caching gotcha as /pnl.
export const dynamic = 'force-dynamic';

function money(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const BILL_STATUS_VARIANT: Record<string, 'amber' | 'blue' | 'green' | 'outline'> = {
  pending_review: 'amber',
  approved: 'blue',
  scheduled_for_payment: 'blue',
};

/**
 * OPEX tracker — the operations/admin view of firm overhead. Built for
 * the office-manager seat: monthly cadence by ATO category, run-rate
 * vs FY budget, the unpaid pipeline, and unbudgeted spend. Partners'
 * strategic view stays on /pnl; this is the working surface.
 */
export default async function OpexTrackerPage({
  searchParams,
}: {
  searchParams: { fy?: string };
}) {
  const session = await getSession();
  if (!session || !hasAnyRole(session, ['super_admin', 'admin'])) notFound();

  const currentFy = auFyOf(new Date());
  const fyOptions = [currentFy, currentFy - 1];
  const selected = fyOptions.includes(Number(searchParams.fy))
    ? Number(searchParams.fy)
    : currentFy;

  const t = await computeOpexTracker(selected);
  const opex = t.budget.opex;
  const plannedCents = opex.totalPlannedCents;
  const overRunRate = t.runRateCents !== null && plannedCents > 0 && t.runRateCents > plannedCents;
  const openTotal = t.openBills.reduce((s, b) => s + (b.amountTotal - b.gst), 0);
  // Months with any spend cap the matrix width on small screens less —
  // render all 12 anyway; the wrapper scrolls.

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">OPEX tracker</h1>
          <p className="text-sm text-ink-3">
            Firm overhead by month and ATO category, tracked against the{' '}
            {auFyLabel(selected)} budget. Bills tagged to the FH buckets
            (FHB000 / FHO000 / FHX000) count here once approved.
          </p>
        </div>
        <nav className="flex items-center gap-1 rounded-md border border-line bg-card p-1 text-sm">
          {fyOptions.map((fy) => (
            <Link
              key={fy}
              href={`/admin/opex?fy=${fy}`}
              className={cn(
                'rounded px-3 py-1',
                selected === fy
                  ? 'bg-brand text-white'
                  : 'text-ink-3 hover:text-ink',
              )}
            >
              {auFyLabel(fy)}
            </Link>
          ))}
        </nav>
      </header>

      {/* ── Headline tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="py-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-3">
              Spent FYTD (ex GST)
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
              {money(t.totalActualCents)}
            </div>
            <div className="text-[11px] text-ink-3">
              across {t.monthsElapsed} {t.monthsElapsed === 1 ? 'month' : 'months'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-3">
              FY budget
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
              {plannedCents > 0 ? money(plannedCents) : '—'}
            </div>
            <div className="text-[11px] text-ink-3">
              {t.budget.hasBudget
                ? `${opex.byCategory.reduce((s, c) => s + c.lines.length, 0)} budget lines`
                : 'No budget set for this FY'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-3">
              Annualised run-rate
            </div>
            <div
              className={cn(
                'mt-0.5 text-lg font-semibold tabular-nums',
                overRunRate ? 'text-status-red' : 'text-ink',
              )}
            >
              {t.runRateCents !== null ? money(t.runRateCents) : '—'}
            </div>
            <div className="text-[11px] text-ink-3">
              {overRunRate
                ? 'Tracking OVER budget at this pace'
                : plannedCents > 0 && t.runRateCents !== null
                  ? 'Tracking within budget'
                  : 'Needs budget + spend to compare'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-3">
              Unpaid pipeline
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
              {money(openTotal)}
            </div>
            <div className="text-[11px] text-ink-3">
              {t.openBills.length} open {t.openBills.length === 1 ? 'bill' : 'bills'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Month × category matrix ────────────────────────────────── */}
      <Card className="p-0">
        <CardHeader>
          <CardTitle>Monthly spend by category</CardTitle>
          <p className="text-[11px] text-ink-3">
            Ex-GST, by bill issue date. Approved / scheduled / paid bills only —
            the unpaid pipeline below is not in these numbers yet.
          </p>
        </CardHeader>
        {t.matrix.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-3">
              No firm-OPEX bills recorded for {auFyLabel(selected)} yet.
              Bills land here once they&apos;re tagged to an FH bucket and
              approved — upload via{' '}
              <Link href="/bills/intake" className="text-brand hover:underline">
                Receipt Upload
              </Link>
              .
            </p>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left">Category</th>
                  {Array.from({ length: 12 }, (_, m) => (
                    <th key={m} className="px-2 py-2 text-right">
                      {fyMonthLabel(m)}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {t.matrix.map((row) => (
                  <tr key={row.atoCategory} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2 text-ink">{row.atoCategory}</td>
                    {row.months.map((cents, m) => (
                      <td
                        key={m}
                        className={cn(
                          'px-2 py-2 text-right tabular-nums',
                          cents === 0 ? 'text-ink-4' : 'text-ink-2',
                        )}
                      >
                        {cents === 0 ? '·' : money(cents)}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink">
                      {money(row.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-subtle/60">
                <tr>
                  <td className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                    Month total
                  </td>
                  {t.monthTotals.map((cents, m) => (
                    <td key={m} className="px-2 py-2 text-right font-medium tabular-nums text-ink-2">
                      {cents === 0 ? '·' : money(cents)}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink">
                    {money(t.totalActualCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ── Budget vs actual by category ───────────────────────────── */}
      <Card className="p-0">
        <CardHeader>
          <CardTitle>Budget vs actual · {auFyLabel(selected)}</CardTitle>
          <p className="text-[11px] text-ink-3">
            Planned amounts come from the FY budget&apos;s OPEX lines
            (Vendors &amp; Systems Register). Categories with spend but no
            budget line surface here too — that&apos;s unplanned spend worth
            a look.
          </p>
        </CardHeader>
        {!t.budget.hasBudget && opex.byCategory.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-3">
              No budget set for {auFyLabel(selected)} and no spend recorded.
            </p>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left">ATO category</th>
                  <th className="px-4 py-2 text-right">Planned</th>
                  <th className="px-4 py-2 text-right">Actual</th>
                  <th className="px-4 py-2 text-right">Variance</th>
                  <th className="px-4 py-2 text-left">Lines</th>
                </tr>
              </thead>
              <tbody>
                {opex.byCategory.map((cat) => {
                  const over = cat.varianceCents < 0;
                  const unbudgeted = cat.plannedCents === 0 && cat.actualCents > 0;
                  return (
                    <tr key={cat.atoCategory} className="border-b border-line last:border-b-0 align-top">
                      <td className="px-4 py-2 text-ink">
                        {cat.atoCategory}
                        {unbudgeted && (
                          <Badge variant="amber" className="ml-2 text-[10px]">
                            unbudgeted
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                        {cat.plannedCents > 0 ? money(cat.plannedCents) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">
                        {money(cat.actualCents)}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2 text-right tabular-nums',
                          over ? 'font-medium text-status-red' : 'text-status-green',
                        )}
                      >
                        {cat.plannedCents > 0 || cat.actualCents > 0
                          ? money(cat.varianceCents)
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-[11px] text-ink-3">
                        {cat.lines.length === 0
                          ? '—'
                          : cat.lines
                              .map((l) => `${l.label}${l.vendor ? ` (${l.vendor})` : ''}`)
                              .join(' · ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-surface-subtle/60">
                <tr>
                  <td className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                    Total
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {money(opex.totalPlannedCents)}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {money(opex.totalActualCents)}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2 text-right font-semibold tabular-nums',
                      opex.totalPlannedCents - opex.totalActualCents < 0
                        ? 'text-status-red'
                        : 'text-status-green',
                    )}
                  >
                    {money(opex.totalPlannedCents - opex.totalActualCents)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ── Unpaid pipeline ────────────────────────────────────────── */}
      <Card className="p-0">
        <CardHeader className="flex flex-row items-end justify-between gap-2">
          <div>
            <CardTitle>Unpaid pipeline ({t.openBills.length})</CardTitle>
            <p className="text-[11px] text-ink-3">
              OPEX bills awaiting review, approval, or payment — oldest due
              first. Work these from{' '}
              <Link href="/bills" className="text-brand hover:underline">
                Bills (Payables)
              </Link>
              .
            </p>
          </div>
        </CardHeader>
        {t.openBills.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-3">Nothing outstanding. Clear runway.</p>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left">Supplier</th>
                  <th className="px-4 py-2 text-left">Category</th>
                  <th className="px-4 py-2 text-left">Bucket</th>
                  <th className="px-4 py-2 text-right">Amount (inc GST)</th>
                  <th className="px-4 py-2 text-right">Due</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {t.openBills.map((b) => {
                  const overdue = b.dueDate.getTime() < Date.now();
                  return (
                    <tr key={b.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2 text-ink">
                        {b.supplierName ?? '—'}
                        {b.supplierInvoiceNumber && (
                          <span className="ml-1 font-mono text-[11px] text-ink-3">
                            {b.supplierInvoiceNumber}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-ink-2">{b.category ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-3">{b.bucketCode}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">
                        {money(b.amountTotal)}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2 text-right tabular-nums text-xs',
                          overdue ? 'font-medium text-status-red' : 'text-ink-3',
                        )}
                      >
                        {b.dueDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={BILL_STATUS_VARIANT[b.status] ?? 'outline'}
                          className="text-[10px] capitalize"
                        >
                          {b.status.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
