import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeFirmPnL, computeRevenueByFy } from '@/server/reports/pnl';
import { computeFyBudgetActuals, type FyBudgetActuals } from '@/server/reports/fy-budget';
import { auFyOf, auFyLabel, auFyWindow } from '@/lib/au-fy';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WaterfallChart, type WaterfallStep } from '@/components/charts/waterfall';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// FY switching must re-fetch every time — Next.js otherwise treats
// /pnl?fy=26 and /pnl?fy=27 as the same cache key on Vercel and both
// tabs return the same numbers.
export const dynamic = 'force-dynamic';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const STAGE_VARIANT: Record<string, 'amber' | 'green' | 'blue' | 'outline'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};

export default async function FirmPnLPage({
  searchParams,
}: {
  searchParams: { fy?: string };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  // ─── FY selector ─────────────────────────────────────────────────
  // Current AU FY based on server today; scope is either that FY, an
  // adjacent one, or "all" (no window).
  const currentFy = auFyOf(new Date());
  // Live FY first, then prior FY, then All time — matches how TT reads
  // the page (default view = what's happening now, drill back for history).
  const availableFys = [currentFy, currentFy - 1]; // e.g. FY27 + FY26
  const selectedRaw = searchParams.fy ?? String(currentFy);
  const selected: number | 'all' = selectedRaw === 'all'
    ? 'all'
    : Number(selectedRaw) || currentFy;
  const window = selected === 'all' ? undefined : auFyWindow(selected);
  const scopeLabel = selected === 'all' ? 'All time' : auFyLabel(selected);
  const isActiveFy = selected === currentFy;
  const isArchivedFy = typeof selected === 'number' && selected < currentFy;

  const pnl = await computeFirmPnL(window);
  // Only fetch budget-vs-actuals for the active FY — archived FYs
  // stay a pure actuals view; all-time doesn't have a "budget" concept.
  const budgetActuals = isActiveFy && typeof selected === 'number'
    ? await computeFyBudgetActuals(selected)
    : null;
  // Per-FY revenue rollup — only shown on the "All time" tab. Historical
  // years (FY<26) don't carry cost detail, so the table renders those
  // rows as revenue-only per TT's "eat what you kill" call.
  const revenueByFy = selected === 'all' ? await computeRevenueByFy() : null;
  const maxMonthly = Math.max(
    1,
    ...pnl.monthly.flatMap((m) => [m.revenueCents, m.costCents]),
  );

  // ─── Firm waterfall — mirrors master tracker's Key Readouts ───────
  // Revenue → consultant cost → project expenses → gross profit →
  // firm OPEX → EBIT → tax reserve → distributable profit. Structure
  // matches "Foundry Health FY26 Financial Tracker" so the app and the
  // spreadsheet tie to the same numbers.
  //
  // Contract value (booked) is shown separately in the KPI tiles above
  // — it doesn't sit inside the P&L waterfall (booked isn't earned).
  const TAX_RESERVE_PCT = 30;
  const revenueCents = pnl.totals.revenueCents;
  const consultantCostCents = pnl.totals.consultantCostCents;
  const projectExpenseCents = pnl.totals.projectExpenseCents;
  const grossProfitCents = pnl.totals.grossProfitCents;
  const firmOpexCents = pnl.totals.firmOpexCents;
  const ebitCents = pnl.totals.ebitCents;
  const taxReserveCents =
    ebitCents > 0 ? Math.round((ebitCents * TAX_RESERVE_PCT) / 100) : 0;
  const distributableProfitCents = ebitCents - taxReserveCents;

  // % of revenue helper — used for every bar so partners can scan the
  // whole cascade in one sweep.
  const pctOfRev = (cents: number): string =>
    revenueCents > 0
      ? `${Math.round((Math.abs(cents) / revenueCents) * 100)}%`
      : '';

  const firmWaterfall: WaterfallStep[] = [
    {
      key: 'revenue',
      label: 'Revenue',
      sub: 'invoiced ex GST',
      valueCents: revenueCents,
      kind: 'total',
      tone: 'brand',
      percentLabel: '100%',
    },
    {
      key: 'consultant',
      label: 'Consultant cost',
      sub: 'contractors + timesheets',
      valueCents: -consultantCostCents,
      kind: 'flow',
      tone: 'orange',
      percentLabel: pctOfRev(consultantCostCents),
    },
    ...(projectExpenseCents > 0
      ? [
          {
            key: 'projectExpense' as const,
            label: 'Project expenses',
            sub: 'project-tagged bills',
            valueCents: -projectExpenseCents,
            kind: 'flow' as const,
            tone: 'orange' as const,
            percentLabel: pctOfRev(projectExpenseCents),
          },
        ]
      : []),
    {
      key: 'gross',
      label: 'Gross profit',
      sub: 'revenue − consultant − expenses',
      valueCents: grossProfitCents,
      kind: 'subtotal',
      tone: grossProfitCents >= 0 ? 'green' : 'red',
      percentLabel: pctOfRev(grossProfitCents),
    },
    {
      key: 'opex',
      label: 'Company OPEX',
      sub: 'firm overhead · FH buckets',
      valueCents: -firmOpexCents,
      kind: 'flow',
      tone: 'orange',
      percentLabel: pctOfRev(firmOpexCents),
    },
    {
      key: 'ebit',
      label: 'EBIT',
      sub: 'operating profit',
      valueCents: ebitCents,
      kind: 'subtotal',
      tone: ebitCents >= 0 ? 'green' : 'red',
      percentLabel: pctOfRev(ebitCents),
    },
    {
      key: 'tax',
      label: 'Tax reserve',
      sub: `${TAX_RESERVE_PCT}% of EBIT`,
      valueCents: -taxReserveCents,
      kind: 'flow',
      tone: 'muted',
      estimated: true,
      percentLabel: pctOfRev(taxReserveCents),
    },
    {
      key: 'profit',
      label: 'Distributable',
      sub: 'partner profit pool',
      valueCents: distributableProfitCents,
      kind: 'total',
      tone: distributableProfitCents >= 0 ? 'green' : 'red',
      percentLabel: pctOfRev(distributableProfitCents),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            Firm P&amp;L · {scopeLabel}
            {isActiveFy && (
              <Badge variant="green" className="ml-2 align-middle text-[10px] uppercase">
                active
              </Badge>
            )}
            {isArchivedFy && (
              <Badge variant="outline" className="ml-2 align-middle text-[10px] uppercase">
                archived
              </Badge>
            )}
          </h1>
          <p className="text-sm text-ink-3">
            {selected === 'all'
              ? 'All-time revenue vs cost across every project.'
              : `Revenue and cost within the ${scopeLabel} window (1 Jul → 30 Jun). Cost uses current Person.rate for timesheets.`}
          </p>
        </div>
        <a
          href="/api/reports/pnl"
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
        >
          Download CSV
        </a>
      </header>

      {/* ── FY tabs ────────────────────────────────────────────────── */}
      <nav className="flex items-center gap-1 border-b border-line">
        {[...availableFys, 'all' as const].map((opt) => {
          const label = opt === 'all' ? 'All time' : auFyLabel(opt);
          const isSelected = selected === opt;
          const isActive = opt === currentFy;
          return (
            <Link
              key={String(opt)}
              href={opt === 'all' ? '/pnl?fy=all' : `/pnl?fy=${opt}`}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
                isSelected
                  ? 'border-brand text-ink'
                  : 'border-transparent text-ink-3 hover:text-ink-2',
              )}
            >
              {label}
              {isActive && (
                <span className="rounded-sm bg-status-green-soft px-1 text-[10px] font-medium uppercase text-status-green">
                  live
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Firm earnings to date — only on the "All time" tab. FY-specific
          tabs stay purely scoped to their window, no duplicate summary
          up top. */}
      {selected === 'all' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Firm earnings — all-time
              <Badge variant="outline" className="ml-2 align-middle text-[10px] uppercase">
                cumulative
              </Badge>
            </CardTitle>
            <p className="text-xs text-ink-3">
              Every FY on record. Includes historical backfill (FY21-FY25) + live FY26/FY27 activity.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 py-3 md:grid-cols-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-ink-3">
                All-time revenue invoiced
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                {formatMoney(pnl.cumulative.revenueCents)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-ink-3">
                All-time payments received
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                {formatMoney(pnl.cumulative.receivedCents)}
              </div>
              <div className="text-[10px] text-ink-3">
                {pnl.cumulative.revenueCents > 0
                  ? `${Math.round((pnl.cumulative.receivedCents / pnl.cumulative.revenueCents) * 100)}% collected`
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-ink-3">
                Contracts won (lifetime)
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                {formatMoney(pnl.cumulative.contractsWonCents)}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue by FY — only on "All time". FY21-25 are shell-backfill
          with revenue only (no cost detail — TT's "eat what you kill"
          call, all revenue treated as acquitted). FY26+ carry the full
          margin picture in the waterfall below. */}
      {selected === 'all' && revenueByFy && revenueByFy.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Revenue by financial year</CardTitle>
            <p className="text-xs text-ink-3">
              Lifetime revenue split by AU financial year. FY21-25 are historical shell-backfill —
              in that period we operated eat-what-you-kill with no cost tracking, so 100% of revenue
              is treated as acquitted. FY26 onwards carries the full cost stack (see waterfall).
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-line-2 text-left text-[11px] uppercase tracking-wide text-ink-3">
                    <th className="py-2 pr-3 font-medium">FY</th>
                    <th className="py-2 pr-3 font-medium">Invoices</th>
                    <th className="py-2 pr-3 text-right font-medium">Revenue</th>
                    <th className="py-2 pr-3 text-right font-medium">% of lifetime</th>
                    <th className="py-2 pl-3 font-medium">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueByFy.rows.map((row) => {
                    const share = revenueByFy.totalRevenueCents === 0
                      ? 0
                      : (row.revenueCents / revenueByFy.totalRevenueCents) * 100;
                    return (
                      <tr key={row.yearEnding} className="border-b border-line-1 last:border-b-0">
                        <td className="py-2 pr-3 font-medium text-ink">
                          {auFyLabel(row.yearEnding)}
                        </td>
                        <td className="py-2 pr-3 text-ink-2">{row.invoices}</td>
                        <td className="py-2 pr-3 text-right font-semibold text-ink">
                          {formatMoney(row.revenueCents)}
                        </td>
                        <td className="py-2 pr-3 text-right text-ink-2">
                          {share.toFixed(1)}%
                        </td>
                        <td className="py-2 pl-3">
                          {row.hasCostDetail ? (
                            <Badge variant="outline" className="text-[10px] uppercase">
                              Full P&amp;L
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] uppercase text-ink-3">
                              Revenue only · acquitted
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line-2 text-sm font-semibold">
                    <td className="py-2 pr-3">Lifetime</td>
                    <td className="py-2 pr-3 text-ink-2">
                      {revenueByFy.rows.reduce((s, r) => s + r.invoices, 0)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {formatMoney(revenueByFy.totalRevenueCents)}
                    </td>
                    <td className="py-2 pr-3 text-right text-ink-2">100.0%</td>
                    <td className="py-2 pl-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scope-clarifier line — only relevant when a specific FY is selected. */}
      {selected !== 'all' && (
        <p className="text-xs text-ink-3">
          Tiles + waterfall below are scoped to <strong>{scopeLabel}</strong>. Switch tabs above to change window.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <TotalCard
          label="Revenue"
          value={formatMoney(pnl.totals.revenueCents)}
          sub={`${formatMoney(pnl.totals.wipCents)} WIP · ex GST`}
        />
        <TotalCard
          label="Consultant cost"
          value={formatMoney(pnl.totals.consultantCostCents)}
          sub="Contractor invoices + timesheets"
        />
        <TotalCard
          label="Gross profit"
          value={formatMoney(pnl.totals.grossProfitCents)}
          sub={
            pnl.totals.revenueCents > 0
              ? `${Math.round((pnl.totals.grossProfitCents / pnl.totals.revenueCents) * 100)}% margin`
              : '—'
          }
          emphasis={pnl.totals.grossProfitCents < 0}
        />
        <TotalCard
          label="Company OPEX"
          value={formatMoney(pnl.totals.firmOpexCents)}
          sub="Firm overhead · FH buckets"
        />
        <TotalCard
          label="EBIT"
          value={formatMoney(pnl.totals.ebitCents)}
          sub={
            pnl.totals.revenueCents > 0
              ? `${Math.round((pnl.totals.ebitCents / pnl.totals.revenueCents) * 100)}% margin`
              : '—'
          }
          emphasis={pnl.totals.ebitCents < 0}
        />
        <TotalCard
          label="Contract value"
          value={formatMoney(pnl.totals.contractValueCents)}
          sub={`Booked · ${pnl.totals.hours.toFixed(0)}h logged`}
        />
      </div>

      {budgetActuals && (
        <BudgetActualsSection
          data={budgetActuals}
          fyLabel={scopeLabel}
          formatMoney={formatMoney}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Firm waterfall</CardTitle>
          <p className="text-xs text-ink-3">
            Invoiced revenue → consultant cost → gross profit →
            company OPEX → EBIT → tax reserve → distributable profit.
            Structure mirrors the FY26 master tracker&apos;s Key
            Readouts sheet so the app and the spreadsheet tie to the
            same numbers. Tax reserve is hatched — 30% of EBIT is a
            planning estimate, not a filed figure.
          </p>
        </CardHeader>
        <CardContent>
          <WaterfallChart
            steps={firmWaterfall}
            caption="Lifetime · all projects, ex GST"
          />
        </CardContent>
      </Card>

      {pnl.monthly.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Monthly revenue vs cost</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pnl.monthly.map((m) => (
              <div
                key={m.month}
                className="grid grid-cols-[80px_1fr_1fr] items-center gap-3"
              >
                <span className="font-mono text-xs text-ink-3">{m.month}</span>
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 rounded bg-status-green"
                    style={{
                      width: `${Math.round((m.revenueCents / maxMonthly) * 100)}%`,
                      minWidth: m.revenueCents > 0 ? '4px' : '0',
                    }}
                    aria-label={`Revenue ${formatMoney(m.revenueCents)}`}
                  />
                  <span className="tabular-nums text-xs text-ink-2">
                    {formatMoney(m.revenueCents)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 rounded bg-status-red"
                    style={{
                      width: `${Math.round((m.costCents / maxMonthly) * 100)}%`,
                      minWidth: m.costCents > 0 ? '4px' : '0',
                    }}
                    aria-label={`Cost ${formatMoney(m.costCents)}`}
                  />
                  <span className="tabular-nums text-xs text-ink-2">
                    {formatMoney(m.costCents)}
                  </span>
                </div>
              </div>
            ))}
            <div className="mt-2 flex gap-4 text-xs text-ink-3">
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded bg-status-green" />
                Revenue (invoiced)
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded bg-status-red" />
                Cost
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="p-0">
        <CardHeader>
          <CardTitle>Projects ({pnl.projects.length})</CardTitle>
        </CardHeader>
        {pnl.projects.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-3">No projects yet.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Contract</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">WIP</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pnl.projects.map((p) => {
                const activeRev = p.revenueCents + p.wipCents;
                const pct =
                  activeRev > 0 ? Math.round((p.marginCents / activeRev) * 100) : null;
                return (
                  <TableRow key={p.projectId}>
                    <TableCell>
                      <Link
                        href={`/projects/${p.code}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <span className="font-mono text-xs text-ink-3">{p.code}</span>
                        <span className="text-sm text-ink">{p.name}</span>
                        <span className="font-mono text-[10px] text-ink-4">
                          · {p.clientCode}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STAGE_VARIANT[p.stage] ?? 'outline'}
                        className="capitalize"
                      >
                        {p.stage}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-3">
                      {formatMoney(p.contractValueCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink">
                      {formatMoney(p.revenueCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-3">
                      {formatMoney(p.wipCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-3">
                      {formatMoney(p.costCents)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        p.marginCents < 0 ? 'text-status-red' : 'text-ink'
                      }`}
                    >
                      {formatMoney(p.marginCents)}
                      {pct !== null && (
                        <span className="ml-1 text-xs text-ink-3">({pct}%)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-3">
                      {p.hours.toFixed(1)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function TotalCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`text-lg font-semibold tabular-nums ${
            emphasis ? 'text-status-red' : 'text-ink'
          }`}
        >
          {value}
        </div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function BudgetActualsSection({
  data,
  fyLabel,
  formatMoney,
}: {
  data: FyBudgetActuals;
  fyLabel: string;
  formatMoney: (cents: number) => string;
}) {
  const rows = [
    data.topLine.revenue,
    data.topLine.consultantCost,
    data.topLine.projectExpense,
    data.topLine.firmOpex,
    data.topLine.ebit,
  ];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Budget vs actuals · {fyLabel}</CardTitle>
          <p className="mt-1 text-xs text-ink-3">
            Plan set for {fyLabel}; actuals pulled live from invoices, contractor
            costs, timesheets, and OPEX bills. Positive variance = under budget.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!data.hasBudget && (
            <Badge variant="amber" className="text-[10px] uppercase">
              No budget saved
            </Badge>
          )}
          <Link
            href="/admin/fy-budget"
            className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            {data.hasBudget ? 'Edit budget' : 'Set budget'}
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Top-line variance table */}
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-xs text-ink-3">
              <tr>
                <th className="px-3 py-2 text-left">Line</th>
                <th className="px-3 py-2 text-right">Budget</th>
                <th className="px-3 py-2 text-right">Actuals</th>
                <th className="px-3 py-2 text-right">Variance</th>
                <th className="px-3 py-2 text-right">Variance %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => {
                const goodWhenUnder = i > 0 && i < 4; // costs — good when actual < budget
                const goodWhenOver = i === 0 || i === 4; // revenue + EBIT — good when actual > budget
                const positive = r.varianceCents > 0;
                const varColour = positive
                  ? goodWhenUnder ? 'text-status-green' : goodWhenOver ? 'text-status-red' : 'text-ink'
                  : r.varianceCents < 0
                    ? goodWhenOver ? 'text-status-green' : goodWhenUnder ? 'text-status-red' : 'text-ink'
                    : 'text-ink-3';
                return (
                  <tr key={r.label}>
                    <td className="px-3 py-2 font-medium text-ink">{r.label}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-2">
                      {formatMoney(r.plannedCents)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                      {formatMoney(r.actualCents)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${varColour}`}>
                      {formatMoney(r.varianceCents)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${varColour}`}>
                      {r.variancePct !== null ? `${r.variancePct}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* OPEX breakdown by ATO category */}
        {data.opex.byCategory.length > 0 && (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-medium text-ink">OPEX by ATO category</h3>
              <div className="text-xs text-ink-3">
                {formatMoney(data.opex.totalActualCents)} of {formatMoney(data.opex.totalPlannedCents)} planned
              </div>
            </div>
            <div className="space-y-2">
              {data.opex.byCategory.map((cat) => (
                <details key={cat.atoCategory} className="rounded-md border border-line" open>
                  <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-hover">
                    <span className="font-medium text-ink">{cat.atoCategory}</span>
                    <span className="flex items-center gap-4 text-xs">
                      <span className="text-ink-3">
                        Budget <span className="font-mono tabular-nums text-ink">{formatMoney(cat.plannedCents)}</span>
                      </span>
                      <span className="text-ink-3">
                        Actual <span className="font-mono tabular-nums text-ink">{formatMoney(cat.actualCents)}</span>
                      </span>
                      <span
                        className={`font-mono tabular-nums ${cat.varianceCents >= 0 ? 'text-status-green' : 'text-status-red'}`}
                      >
                        {formatMoney(cat.varianceCents)}
                        {cat.variancePct !== null && ` (${cat.variancePct}%)`}
                      </span>
                    </span>
                  </summary>
                  {cat.lines.length > 0 ? (
                    <div className="overflow-hidden border-t border-line">
                      <table className="w-full text-xs">
                        <thead className="bg-surface-subtle/40 text-ink-3">
                          <tr>
                            <th className="px-3 py-1.5 text-left">Line</th>
                            <th className="px-3 py-1.5 text-left">Vendor</th>
                            <th className="px-3 py-1.5 text-left">Cadence</th>
                            <th className="px-3 py-1.5 text-right">Planned (annual)</th>
                            <th className="px-3 py-1.5 text-left">Carry over</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {cat.lines.map((line) => (
                            <tr key={line.id}>
                              <td className="px-3 py-1.5 text-ink">{line.label}</td>
                              <td className="px-3 py-1.5 text-ink-2">{line.vendor ?? '—'}</td>
                              <td className="px-3 py-1.5 capitalize text-ink-3">
                                {line.cadence.replace('_', ' ')}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">
                                {formatMoney(line.plannedCents)}
                              </td>
                              <td className="px-3 py-1.5">
                                {line.isCarryOver ? (
                                  <Badge variant="green" className="text-[10px]">
                                    carry
                                  </Badge>
                                ) : (
                                  <span className="text-ink-3">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-3 py-3 text-xs italic text-ink-3">
                      Actual spend recorded here, no budget lines set.
                    </div>
                  )}
                </details>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
