import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import {
  computeFirmUtilisation,
  currentMonthYm,
  monthOptions,
} from '@/server/reports/utilisation';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  if (!y || !m) return ym;
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function utilBadge(pct: number | null): 'outline' | 'green' | 'amber' | 'red' {
  if (pct === null) return 'outline';
  if (pct >= 110) return 'red'; // over-allocated
  if (pct >= 80) return 'green'; // target
  if (pct >= 50) return 'amber'; // below target but engaged
  return 'outline';
}

export default async function UtilisationPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const months = monthOptions(12);
  const rawMonth = searchParams.month?.trim();
  const month = rawMonth && months.includes(rawMonth) ? rawMonth : currentMonthYm();

  const data = await computeFirmUtilisation(month);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Utilisation</h1>
        <p className="text-sm text-ink-3">
          Approved + billed hours vs target (FTE × 160h/month) for{' '}
          {monthLabel(month)}. Target scales pro-rata for joiners / leavers
          mid-month.
        </p>
      </header>

      <form
        action="/utilisation"
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3"
      >
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <span>Month</span>
          <select
            name="month"
            defaultValue={month}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <TotalCard
          label="Headcount"
          value={String(data.totals.activeHeadcount)}
          sub="Active this month"
        />
        <TotalCard
          label="Target hrs"
          value={data.totals.targetHours.toFixed(1)}
          sub={`${data.rows.length} people counted`}
        />
        <TotalCard
          label="Logged hrs"
          value={data.totals.loggedHours.toFixed(1)}
          sub="Approved + billed"
        />
        <TotalCard
          label="Firm utilisation"
          value={
            data.totals.utilisationPct === null
              ? '—'
              : `${data.totals.utilisationPct}%`
          }
          sub="Logged ÷ target"
          emphasis={data.totals.utilisationPct !== null && data.totals.utilisationPct < 60}
        />
        <TotalCard
          label="Billable rate"
          value={
            data.totals.billableRatePct === null
              ? '—'
              : `${data.totals.billableRatePct}%`
          }
          sub={`${data.totals.billedHours.toFixed(1)} billed hrs`}
        />
      </div>

      {data.rows.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-3">
          No active people this month.
        </Card>
      ) : (
        <Card className="p-0">
          <CardHeader>
            <CardTitle>By person</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Band / Level</TableHead>
                <TableHead className="text-right">FTE</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-right">Logged</TableHead>
                <TableHead>Utilisation</TableHead>
                <TableHead>Top projects</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => {
                const maxBarPct = Math.min(200, Math.max(0, r.utilisationPct ?? 0));
                return (
                  <TableRow key={r.personId}>
                    <TableCell>
                      <Link
                        href={`/directory/people/${r.personId}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[10px]">
                            {r.initials}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-ink">
                          {r.firstName} {r.lastName}
                        </span>
                        {!r.active && (
                          <Badge variant="outline" className="text-[10px]">
                            Ended
                          </Badge>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-ink-3">
                      {r.band} · {r.level}{' '}
                      <span className="ml-1 text-[10px] text-ink-4">
                        {r.employment === 'ft' ? 'FT' : 'Contractor'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-ink-3">
                      {r.fte.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-ink-3">
                      {r.targetHours.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-ink">
                      {r.loggedHours.toFixed(1)}
                      {r.billedHours > 0 && (
                        <span className="ml-1 text-[10px] text-ink-3">
                          ({r.billedHours.toFixed(1)} billed)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="relative h-2 w-24 rounded bg-surface-subtle">
                          <div
                            className={`absolute left-0 top-0 h-2 rounded ${
                              (r.utilisationPct ?? 0) >= 110
                                ? 'bg-status-red'
                                : (r.utilisationPct ?? 0) >= 80
                                  ? 'bg-status-green'
                                  : (r.utilisationPct ?? 0) >= 50
                                    ? 'bg-status-amber'
                                    : 'bg-ink-4'
                            }`}
                            style={{ width: `${(maxBarPct / 200) * 100}%` }}
                            aria-label={`Utilisation ${r.utilisationPct ?? 0}%`}
                          />
                          <div
                            className="absolute top-0 h-2 w-[1px] bg-ink-3"
                            style={{ left: '50%' }}
                            aria-label="100% mark"
                          />
                        </div>
                        <Badge variant={utilBadge(r.utilisationPct)} className="text-xs">
                          {r.utilisationPct === null ? '—' : `${r.utilisationPct}%`}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.topProjects.length === 0 ? (
                        <span className="text-xs text-ink-4">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.topProjects.map((p) => (
                            <Link
                              key={p.code}
                              href={`/projects/${p.code}`}
                              className="font-mono text-[11px] text-ink-3 hover:text-ink"
                              title={`${p.name} · ${p.hours.toFixed(1)}h`}
                            >
                              {p.code}
                              <span className="ml-0.5 text-[10px] text-ink-4">
                                ({p.hours.toFixed(0)}h)
                              </span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="text-xs text-ink-3">
        Utilisation uses 160h/month as the full-time baseline (4 × 40h).
        Working-days-per-month with public holidays + leave lands once we track
        those. Billable rate is billed hours ÷ logged hours across the firm.
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
            emphasis ? 'text-status-amber' : 'text-ink'
          }`}
        >
          {value}
        </div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
