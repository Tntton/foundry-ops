import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeBudgetWatch, type BudgetWatchRow } from '@/server/reports/budget-watch';
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

const FLAG_LABEL: Record<BudgetWatchRow['flag'], string> = {
  over_budget: 'Over budget',
  near_budget: 'Near budget',
  margin_squeeze: 'Margin squeeze',
  healthy: 'Healthy',
};
const FLAG_VARIANT: Record<
  BudgetWatchRow['flag'],
  'outline' | 'amber' | 'red'
> = {
  over_budget: 'red',
  near_budget: 'amber',
  margin_squeeze: 'amber',
  healthy: 'outline',
};

const STAGE_VARIANT: Record<string, 'outline' | 'amber' | 'green' | 'blue'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};

export default async function BudgetWatchPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const data = await computeBudgetWatch();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Budget watch</h1>
        <p className="text-sm text-ink-3">
          Active projects at risk of eating into margin. Flags are mutually
          exclusive — a project appears under one category at a time.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <TotalCard
          label="Active projects"
          value={String(data.totalActiveProjects)}
          sub="Not archived"
        />
        <TotalCard
          label="Over budget"
          value={String(data.summary.overBudget)}
          sub="Cost ≥ contract"
          emphasis={data.summary.overBudget > 0}
          tone="red"
        />
        <TotalCard
          label="Near budget"
          value={String(data.summary.nearBudget)}
          sub="Cost 80–100% of contract"
          emphasis={data.summary.nearBudget > 0}
          tone="amber"
        />
        <TotalCard
          label="Margin squeeze"
          value={String(data.summary.marginSqueeze)}
          sub="< 20% margin"
          emphasis={data.summary.marginSqueeze > 0}
          tone="amber"
        />
      </div>

      <Card className="p-0">
        {data.flagged.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            Every active project is in good shape. Cost is below 80% of contract and
            realised margin is ≥ 20% on everything with activity.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flag</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Contract</TableHead>
                <TableHead className="text-right">Cost / Contract</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.flagged.map((p) => (
                <TableRow key={p.projectId}>
                  <TableCell>
                    <Badge variant={FLAG_VARIANT[p.flag]} className="capitalize">
                      {FLAG_LABEL[p.flag]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/projects/${p.code}`}
                      className="flex items-center gap-1.5 hover:underline"
                    >
                      <span className="font-mono text-xs text-ink-3">{p.code}</span>
                      <span className="text-ink">{p.name}</span>
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
                  <TableCell className="text-right tabular-nums">
                    <span
                      className={`font-semibold ${
                        p.costOfContractPct !== null && p.costOfContractPct >= 100
                          ? 'text-status-red'
                          : p.costOfContractPct !== null && p.costOfContractPct >= 80
                            ? 'text-status-amber'
                            : 'text-ink'
                      }`}
                    >
                      {p.costOfContractPct === null ? '—' : `${p.costOfContractPct.toFixed(0)}%`}
                    </span>
                    <span className="ml-1 text-xs text-ink-3">
                      ({formatMoney(p.costCents)})
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span
                      className={`font-semibold ${
                        p.marginCents < 0 ? 'text-status-red' : 'text-ink'
                      }`}
                    >
                      {formatMoney(p.marginCents)}
                    </span>
                    {p.marginPct !== null && (
                      <span className="ml-1 text-xs text-ink-3">
                        ({p.marginPct.toFixed(0)}%)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-ink-3">{p.flagReason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-ink-3">
        Thresholds: over-budget = 100% of contract; near-budget = 80–100%; margin
        squeeze = realised margin &lt; 20%. Cost reuses the Firm P&amp;L accounting
        (timesheet × Person.rate + expenses + project-coded bills).
      </p>
    </div>
  );
}

function TotalCard({
  label,
  value,
  sub,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
  tone?: 'red' | 'amber';
}) {
  const cls =
    emphasis && tone === 'red'
      ? 'text-status-red'
      : emphasis && tone === 'amber'
        ? 'text-status-amber'
        : 'text-ink';
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
