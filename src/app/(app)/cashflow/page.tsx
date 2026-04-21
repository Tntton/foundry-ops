import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeCashflow } from '@/server/reports/cashflow';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function weekLabel(iso: string): string {
  if (iso === 'Overdue') return iso;
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default async function CashflowPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const cf = await computeCashflow(12);
  const maxAbs = Math.max(
    1,
    ...cf.buckets.flatMap((b) => [
      Math.abs(b.arExpectedCents),
      Math.abs(b.apDueCents),
    ]),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Cash flow forecast</h1>
        <p className="text-sm text-ink-3">
          12-week forward-looking view combining open AR (collections) and open
          AP (payments due). Amounts are inc GST. Overdue bucket collects any
          dates already past today.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <TotalCard
          label="Expected in (12w)"
          value={formatMoney(cf.totals.arExpectedCents)}
          sub="Open AR by due date"
        />
        <TotalCard
          label="Expected out (12w)"
          value={formatMoney(cf.totals.apDueCents)}
          sub="Open AP by due date"
        />
        <TotalCard
          label="Net (12w)"
          value={formatMoney(cf.totals.netCents)}
          sub={cf.totals.netCents < 0 ? 'Negative — top up cash' : 'Positive'}
          emphasis={cf.totals.netCents < 0}
        />
        <TotalCard
          label="Overdue AR"
          value={formatMoney(cf.totals.arOverdueCents)}
          sub="Past due, open"
          emphasis={cf.totals.arOverdueCents > 0}
        />
        <TotalCard
          label="Overdue AP"
          value={formatMoney(cf.totals.apOverdueCents)}
          sub="Past due, unpaid"
          emphasis={cf.totals.apOverdueCents > 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Weekly breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {cf.buckets.map((b) => {
            const arWidth = Math.round((b.arExpectedCents / maxAbs) * 100);
            const apWidth = Math.round((b.apDueCents / maxAbs) * 100);
            const isOverdue = b.label === 'Overdue';
            return (
              <div
                key={b.label}
                className={`grid grid-cols-[120px_1fr_1fr_120px] items-center gap-3 ${
                  isOverdue ? 'rounded bg-status-red-soft/40 p-1' : ''
                }`}
              >
                <span
                  className={`font-mono text-xs ${
                    isOverdue ? 'font-semibold text-status-red' : 'text-ink-3'
                  }`}
                >
                  {weekLabel(b.label)}
                </span>
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 rounded bg-status-green"
                    style={{
                      width: `${arWidth}%`,
                      minWidth: b.arExpectedCents > 0 ? '4px' : '0',
                    }}
                    aria-label={`AR ${formatMoney(b.arExpectedCents)}`}
                  />
                  <span className="text-right tabular-nums text-xs text-ink-2">
                    {formatMoney(b.arExpectedCents)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 rounded bg-status-red"
                    style={{
                      width: `${apWidth}%`,
                      minWidth: b.apDueCents > 0 ? '4px' : '0',
                    }}
                    aria-label={`AP ${formatMoney(b.apDueCents)}`}
                  />
                  <span className="text-right tabular-nums text-xs text-ink-2">
                    {formatMoney(b.apDueCents)}
                  </span>
                </div>
                <span
                  className={`text-right font-semibold tabular-nums text-xs ${
                    b.netCents < 0 ? 'text-status-red' : 'text-ink'
                  }`}
                >
                  {formatMoney(b.netCents)}
                </span>
              </div>
            );
          })}
          <div className="grid grid-cols-[120px_1fr_1fr_120px] gap-3 border-t border-line pt-2 text-[10px] uppercase tracking-wide text-ink-3">
            <span>Week</span>
            <span>AR expected (in)</span>
            <span>AP due (out)</span>
            <span className="text-right">Net</span>
          </div>
        </CardContent>
      </Card>

      <Card className="p-0">
        <CardHeader>
          <CardTitle>Bucket table</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week starting</TableHead>
              <TableHead className="text-right">AR expected</TableHead>
              <TableHead className="text-right">AP due</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {cf.buckets.map((b) => (
              <TableRow
                key={b.label}
                className={b.label === 'Overdue' ? 'bg-status-red-soft/30' : ''}
              >
                <TableCell className="font-mono text-xs">
                  {b.label === 'Overdue' ? (
                    <Badge variant="red">Overdue</Badge>
                  ) : (
                    weekLabel(b.label)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-ink-2">
                  {formatMoney(b.arExpectedCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-ink-2">
                  {formatMoney(b.apDueCents)}
                </TableCell>
                <TableCell
                  className={`text-right font-semibold tabular-nums ${
                    b.netCents < 0 ? 'text-status-red' : 'text-ink'
                  }`}
                >
                  {formatMoney(b.netCents)}
                </TableCell>
                <TableCell />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-ink-3">
        Excluded from the forecast: draft invoices (not yet approved), pending-review bills
        (not yet approved), paid rows. Collection and payment timing assumes due dates — no
        payment-behaviour smoothing is applied yet.
      </p>
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
