import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeFirmPnL } from '@/server/reports/pnl';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WaterfallChart, type WaterfallStep } from '@/components/charts/waterfall';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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

export default async function FirmPnLPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const pnl = await computeFirmPnL();
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

  const firmWaterfall: WaterfallStep[] = [
    {
      key: 'revenue',
      label: 'Revenue',
      sub: 'invoiced ex GST',
      valueCents: revenueCents,
      kind: 'total',
      tone: 'brand',
    },
    {
      key: 'consultant',
      label: 'Consultant cost',
      sub: 'contractor invoices + timesheets',
      valueCents: -consultantCostCents,
      kind: 'flow',
      tone: 'orange',
    },
    ...(projectExpenseCents > 0
      ? [
          {
            key: 'projectExpense' as const,
            label: 'Project expenses',
            sub: 'project-tagged bills + reimbursables',
            valueCents: -projectExpenseCents,
            kind: 'flow' as const,
            tone: 'orange' as const,
          },
        ]
      : []),
    {
      key: 'gross',
      label: 'Gross profit',
      sub: revenueCents > 0
        ? `${Math.round((grossProfitCents / revenueCents) * 100)}% margin`
        : 'revenue − consultant − expenses',
      valueCents: grossProfitCents,
      kind: 'subtotal',
      tone: grossProfitCents >= 0 ? 'green' : 'red',
    },
    {
      key: 'opex',
      label: 'Company OPEX',
      sub: 'firm overhead · FHB / FHO / FHX buckets',
      valueCents: -firmOpexCents,
      kind: 'flow',
      tone: 'orange',
    },
    {
      key: 'ebit',
      label: 'EBIT',
      sub: revenueCents > 0
        ? `${Math.round((ebitCents / revenueCents) * 100)}% margin · operating profit`
        : 'operating profit',
      valueCents: ebitCents,
      kind: 'subtotal',
      tone: ebitCents >= 0 ? 'green' : 'red',
    },
    {
      key: 'tax',
      label: 'Tax reserve',
      sub: `${TAX_RESERVE_PCT}% of EBIT · estimated`,
      valueCents: -taxReserveCents,
      kind: 'flow',
      tone: 'muted',
      estimated: true,
    },
    {
      key: 'profit',
      label: 'Distributable',
      sub: 'partner profit pool',
      valueCents: distributableProfitCents,
      kind: 'total',
      tone: distributableProfitCents >= 0 ? 'green' : 'red',
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Firm P&amp;L</h1>
          <p className="text-sm text-ink-3">
            Lifetime revenue vs cost across every project, including archived. Revenue
            is ex GST; cost uses current Person.rate for timesheets.
          </p>
        </div>
        <a
          href="/api/reports/pnl"
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
        >
          Download CSV
        </a>
      </header>

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
