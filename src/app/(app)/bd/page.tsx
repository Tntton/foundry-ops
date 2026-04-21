import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { DealStage } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { listDeals, pipelineSummary } from '@/server/deals';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function buildQs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
  return entries.length ? `?${entries.join('&')}` : '';
}

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const STAGE_VARIANT: Record<DealStage, 'outline' | 'amber' | 'green' | 'blue' | 'red'> = {
  lead: 'outline',
  qualifying: 'amber',
  proposal: 'blue',
  negotiation: 'blue',
  won: 'green',
  lost: 'red',
};

const STAGE_OPTIONS: readonly DealStage[] = [
  'lead',
  'qualifying',
  'proposal',
  'negotiation',
  'won',
  'lost',
];

export default async function BdPipelinePage({
  searchParams,
}: {
  searchParams: { stage?: string; q?: string; created?: string };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const canCreate = hasCapability(session, 'deal.create');
  const stage = STAGE_OPTIONS.includes(searchParams.stage as DealStage)
    ? (searchParams.stage as DealStage)
    : undefined;
  const q = searchParams.q?.trim() ?? '';
  const createdFlag = searchParams.created === '1';

  const [deals, summary] = await Promise.all([
    listDeals({
      ...(stage ? { stage } : {}),
      ...(q ? { search: q } : {}),
    }),
    pipelineSummary(),
  ]);

  return (
    <div className="space-y-6">
      {createdFlag && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Deal created.
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">BD pipeline</h1>
          <p className="text-sm text-ink-3">
            Active opportunities across Foundry. Weighted value = expected × probability.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/reports/deals${buildQs({ q, stage })}`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Download CSV
          </a>
          {canCreate && (
            <Button asChild>
              <Link href="/bd/new">+ New deal</Link>
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <TotalCard
          label="Open deals"
          value={String(summary.openCount)}
          sub={`${summary.totalCount} total`}
        />
        <TotalCard
          label="Expected value"
          value={formatMoney(summary.expectedValueCents)}
          sub="Open deals only"
        />
        <TotalCard
          label="Weighted"
          value={formatMoney(summary.weightedValueCents)}
          sub="× probability"
        />
        <TotalCard
          label="Won YTD"
          value={formatMoney(summary.wonValueYtdCents)}
          sub={`${summary.wonCountYtd} ${summary.wonCountYtd === 1 ? 'deal' : 'deals'}`}
        />
        <TotalCard
          label="Lost YTD"
          value={String(summary.lostCountYtd)}
          sub={
            summary.wonCountYtd + summary.lostCountYtd > 0
              ? `${Math.round(
                  (summary.wonCountYtd / (summary.wonCountYtd + summary.lostCountYtd)) *
                    100,
                )}% win rate`
              : '—'
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By stage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {summary.byStage.map((s) => {
            const maxExpected = Math.max(
              1,
              ...summary.byStage.map((x) => x.expectedCents),
            );
            const pct = Math.round((s.expectedCents / maxExpected) * 100);
            return (
              <div
                key={s.stage}
                className="grid grid-cols-[120px_50px_1fr_120px_120px] items-center gap-3"
              >
                <Badge variant={STAGE_VARIANT[s.stage]} className="w-fit capitalize">
                  {s.stage}
                </Badge>
                <span className="tabular-nums text-sm text-ink-2">{s.count}</span>
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 rounded bg-brand"
                    style={{ width: `${pct}%`, minWidth: s.expectedCents > 0 ? '4px' : '0' }}
                  />
                </div>
                <span className="text-right tabular-nums text-xs text-ink-2">
                  {formatMoney(s.expectedCents)}
                </span>
                <span className="text-right tabular-nums text-xs text-ink-3">
                  {formatMoney(s.weightedCents)}
                </span>
              </div>
            );
          })}
          <div className="grid grid-cols-[120px_50px_1fr_120px_120px] gap-3 border-t border-line pt-2 text-[10px] uppercase tracking-wide text-ink-3">
            <span>Stage</span>
            <span>Count</span>
            <span>Expected value</span>
            <span className="text-right">Expected</span>
            <span className="text-right">Weighted</span>
          </div>
        </CardContent>
      </Card>

      <form
        action="/bd"
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3"
      >
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search code, deal name, or client…"
          className="min-w-[240px] max-w-md"
        />
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <span>Stage</span>
          <select
            name="stage"
            defaultValue={stage ?? ''}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">Any</option>
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {(q || stage) && (
          <Button type="button" asChild size="sm" variant="ghost">
            <Link href="/bd">Clear</Link>
          </Button>
        )}
        <span className="ml-auto text-xs text-ink-3">
          {deals.length} {deals.length === 1 ? 'deal' : 'deals'}
        </span>
      </form>

      <Card className="p-0">
        {deals.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            {q || stage ? (
              <>
                No deals match the current filters.{' '}
                <Link href="/bd" className="text-brand hover:underline">
                  Clear →
                </Link>
              </>
            ) : (
              <>
                No deals yet.{' '}
                {canCreate && (
                  <Link href="/bd/new" className="text-brand hover:underline">
                    Add the first one →
                  </Link>
                )}
              </>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Prob</TableHead>
                <TableHead className="text-right">Weighted</TableHead>
                <TableHead>Close by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link
                      href={`/bd/${d.id}`}
                      className="font-mono text-xs text-ink hover:underline"
                    >
                      {d.code}
                    </Link>
                  </TableCell>
                  <TableCell className="text-ink">{d.name}</TableCell>
                  <TableCell className="text-sm">
                    {d.client ? (
                      <Link
                        href={`/directory/clients/${d.client.id}`}
                        className="hover:underline"
                      >
                        <span className="font-mono text-xs text-ink-3">
                          {d.client.code}
                        </span>{' '}
                        <span className="text-ink-2">{d.client.legalName}</span>
                      </Link>
                    ) : d.prospectiveName ? (
                      <span className="italic text-ink-3">
                        {d.prospectiveName} (prospective)
                      </span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STAGE_VARIANT[d.stage]} className="capitalize">
                      {d.stage}
                    </Badge>
                    {d.convertedProject && (
                      <Link
                        href={`/projects/${d.convertedProject.code}`}
                        className="ml-1 text-[10px] text-brand hover:underline"
                      >
                        → {d.convertedProject.code}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Avatar className="h-5 w-5">
                        <AvatarFallback className="text-[9px]">
                          {d.owner.initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs text-ink-2">
                        {d.owner.firstName} {d.owner.lastName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(d.expectedValueCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-ink-3">
                    {d.probabilityPct}%
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-ink">
                    {formatMoney(d.weightedValueCents)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs text-ink-3">
                    {d.targetCloseDate
                      ? d.targetCloseDate.toLocaleDateString('en-AU')
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function TotalCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
