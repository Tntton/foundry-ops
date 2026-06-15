import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { DealStage } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { listDeals, pipelineSummary } from '@/server/deals';
import { prisma } from '@/server/db';
import { PersonAvatar } from '@/components/person-avatar';
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
import { DealsKanban, type KanbanDeal } from './kanban';
import { readCommercialsVisible } from '@/server/commercials-visible';
import { CommercialsToggle } from '@/components/commercials-toggle';

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

function prettyEnum(v: string | null): string {
  if (!v) return '';
  return v
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
  searchParams: {
    stage?: string;
    q?: string;
    created?: string;
    view?: string;
    archived?: string;
  };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const canCreate = hasCapability(session, 'deal.create');
  // Commercial values hidden by default — partners flip on for private
  // review, off for team huddles. Same cookie as /projects.
  const commercialsVisible = await readCommercialsVisible();
  const stage = STAGE_OPTIONS.includes(searchParams.stage as DealStage)
    ? (searchParams.stage as DealStage)
    : undefined;
  const q = searchParams.q?.trim() ?? '';
  const createdFlag = searchParams.created === '1';
  // Kanban is the default view for BD — it matches how partners think
  // about pipeline (columns by stage). List view is opt-in via ?view=list
  // for the dense bulk-scan / CSV-export use case.
  const view: 'kanban' | 'list' = searchParams.view === 'list' ? 'list' : 'kanban';
  const showArchived = searchParams.archived === '1';

  const [deals, summary] = await Promise.all([
    listDeals({
      ...(stage ? { stage } : {}),
      ...(q ? { search: q } : {}),
      includeArchived: showArchived,
    }),
    pipelineSummary(),
  ]);

  // Picklists for the kanban's inline quick-create form. Only fetched
  // when we'll render the kanban — list view doesn't use them. Owners
  // mirror the /bd/new filter (super_admin / admin / partner only); the
  // viewer is pre-selected when eligible.
  const inlineOwners =
    view === 'kanban' && canCreate
      ? await prisma.person.findMany({
          where: {
            endDate: null,
            roles: { hasSome: ['super_admin', 'admin', 'partner'] },
          },
          orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
          select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
        })
      : [];
  const inlineClients =
    view === 'kanban' && canCreate
      ? await prisma.client.findMany({
          where: { archivedAt: null },
          orderBy: { code: 'asc' },
          select: { id: true, code: true, legalName: true },
        })
      : [];
  // session is non-null here — `hasAnyRole` above would have called
  // notFound() otherwise — but TS can't infer that across the helper
  // boundary. The local alias keeps strict-null-checks happy.
  const sessionPersonId = session?.person.id ?? null;
  const defaultOwnerId =
    sessionPersonId !== null
      ? (inlineOwners.find((p) => p.id === sessionPersonId)?.id ?? null)
      : null;

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
            Archived deals {showArchived ? 'are shown inline.' : 'are hidden — toggle below.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CommercialsToggle visible={commercialsVisible} path="/bd" />
          <Link
            href="/bd/outcomes"
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Outcomes →
          </Link>
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
          sub={`${summary.totalCount} active · ${summary.archivedCount} archived`}
        />
        <TotalCard
          label="Expected value"
          value={commercialsVisible ? formatMoney(summary.expectedValueCents) : '—'}
          sub="Open deals only"
        />
        <TotalCard
          label="Weighted"
          value={commercialsVisible ? formatMoney(summary.weightedValueCents) : '—'}
          sub="× probability"
        />
        <TotalCard
          label="Won YTD"
          value={commercialsVisible ? formatMoney(summary.wonValueYtdCents) : '—'}
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
        <input type="hidden" name="view" value={view} />
        {showArchived && <input type="hidden" name="archived" value="1" />}
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {(q || stage) && (
          <Button type="button" asChild size="sm" variant="ghost">
            <Link href={`/bd${buildQs({ view, archived: showArchived ? '1' : '' })}`}>
              Clear
            </Link>
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-ink-3">
          <span>{deals.length} {deals.length === 1 ? 'deal' : 'deals'}</span>
          <span className="text-ink-4">·</span>
          <Link
            href={`/bd${buildQs({ q, stage, view: 'list' })}`}
            className={`rounded-md border px-2 py-1 text-xs ${view === 'list' ? 'border-brand bg-brand text-brand-ink' : 'border-line hover:bg-surface-hover'}`}
          >
            List
          </Link>
          <Link
            href={`/bd${buildQs({ q, stage, view: 'kanban' })}`}
            className={`rounded-md border px-2 py-1 text-xs ${view === 'kanban' ? 'border-brand bg-brand text-brand-ink' : 'border-line hover:bg-surface-hover'}`}
          >
            Kanban
          </Link>
          <span className="text-ink-4">·</span>
          <Link
            href={`/bd${buildQs({ q, stage, view, archived: showArchived ? '' : '1' })}`}
            className="rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-hover"
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Link>
        </div>
      </form>

      {view === 'kanban' ? (
        <DealsKanban
          deals={deals.map<KanbanDeal>((d) => ({
            id: d.id,
            code: d.code,
            name: d.name ?? '(untitled)',
            stage: d.stage,
            clientLabel: d.client
              ? `${d.client.code} · ${d.client.legalName}`
              : d.prospectiveName
                ? `${d.prospectiveName} (prospective)`
                : null,
            clientCode: d.client?.code ?? null,
            clientId: d.client?.id ?? null,
            prospectiveName: d.prospectiveName,
            archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
            expectedValueCents: d.expectedValueCents,
            weightedValueCents: d.weightedValueCents,
            probabilityPct: d.probabilityPct,
            daysSinceLastConversation: d.daysSinceLastConversation,
            clientType: d.clientType,
            engagementType: d.engagementType,
            owner: {
              initials: d.owner.initials,
              firstName: d.owner.firstName,
              lastName: d.owner.lastName,
              headshotUrl: d.owner.headshotUrl,
            },
            sortOrder: d.sortOrder,
          }))}
          canCreate={canCreate}
          canMove={hasCapability(session, 'deal.edit')}
          quickCreateOwners={inlineOwners}
          quickCreateClients={inlineClients}
          defaultOwnerId={defaultOwnerId}
          commercialsVisible={commercialsVisible}
        />
      ) : (
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
                  <TableHead>Type · Sector</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Prob</TableHead>
                  <TableHead className="text-right">Weighted</TableHead>
                  <TableHead>Last convo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deals.map((d) => (
                  <TableRow key={d.id} className={d.archivedAt ? 'opacity-60' : ''}>
                    <TableCell>
                      <Link
                        href={`/bd/${d.id}`}
                        className="font-mono text-xs text-ink hover:underline"
                      >
                        {d.code}
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink">
                      {d.name}
                      {d.engagementType && (
                        <span className="ml-1 text-xs text-ink-3">
                          · {prettyEnum(d.engagementType)}
                        </span>
                      )}
                    </TableCell>
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
                    <TableCell className="text-xs text-ink-3">
                      {[prettyEnum(d.clientType), prettyEnum(d.sector)]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STAGE_VARIANT[d.stage]} className="capitalize">
                        {d.stage}
                      </Badge>
                      {d.archivedAt && (
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          Archived
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <PersonAvatar
  className="h-5 w-5"
  fallbackClassName="text-[9px]"
  initials={d.owner.initials}
  headshotUrl={d.owner.headshotUrl}
/>
                        <span className="text-xs text-ink-2">
                          {d.owner.firstName} {d.owner.lastName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {commercialsVisible ? formatMoney(d.expectedValueCents) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-ink-3">
                      {d.probabilityPct}%
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-ink">
                      {commercialsVisible ? formatMoney(d.weightedValueCents) : '—'}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {d.daysSinceLastConversation === null ? (
                        <span className="text-ink-4">—</span>
                      ) : (
                        <span
                          className={
                            d.daysSinceLastConversation > 30
                              ? 'text-status-amber'
                              : 'text-ink-3'
                          }
                        >
                          {d.daysSinceLastConversation === 0
                            ? 'Today'
                            : `${d.daysSinceLastConversation}d ago`}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
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
