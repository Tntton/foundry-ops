import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ProjectStage } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import {
  listProjects,
  listActivePeopleOptions,
  type ProjectListRow,
  STAGE_LABEL,
} from '@/server/projects';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProjectsKanban } from './kanban';
import { CardAddMember, type CardPersonOption } from './card-add-member';
import { auFyOf, auFyLabel } from '@/lib/au-fy';
import { readCommercialsVisible } from '@/server/commercials-visible';
import { CommercialsToggle } from '@/components/commercials-toggle';

const STAGE_OPTIONS: readonly ProjectStage[] = [
  'kickoff',
  'delivery',
  'closing',
  'archived',
  'standing',
  'benched',
];
const STAGE_VARIANT: Record<ProjectStage, 'amber' | 'green' | 'blue' | 'outline'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
  standing: 'green',
  benched: 'amber',
};

type ViewMode = 'kanban' | 'grid' | 'table';

function buildQs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
  return entries.length ? `?${entries.join('&')}` : '';
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatMoneyShort(cents: number): string {
  if (Math.abs(cents) >= 100_000_000) {
    return `$${(cents / 100_000_000).toFixed(2)}M`;
  }
  if (Math.abs(cents) >= 100_000) {
    return `$${Math.round(cents / 100_000)}k`;
  }
  return formatMoney(cents);
}

function weeksBetween(start: Date, end: Date): number {
  return Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000)),
  );
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: {
    stage?: string;
    active?: string;
    deleted?: string;
    q?: string;
    view?: string;
  };
}) {
  const session = await getSession();
  if (!session) notFound();

  const stage = STAGE_OPTIONS.includes(searchParams.stage as ProjectStage)
    ? (searchParams.stage as ProjectStage)
    : undefined;
  const active =
    searchParams.active === 'true' ? true : searchParams.active === 'false' ? false : undefined;
  const deletedFlag = searchParams.deleted === '1';
  const q = searchParams.q?.trim() ?? '';
  const view: ViewMode =
    searchParams.view === 'grid'
      ? 'grid'
      : searchParams.view === 'table'
        ? 'table'
        : 'kanban';

  const rows = await listProjects(session, {
    stage,
    active,
    search: q || undefined,
  });
  const canCreate = hasCapability(session, 'project.create');
  const canMoveAny = hasAnyRole(session, ['super_admin', 'admin', 'partner', 'manager']);
  // Inline "+ Add member" affordance on each card. Server still
  // gates per-project via project.edit (admin or owning partner /
  // manager); the page-level flag just hides the button for staff.
  const canAddTeamFromCard = hasAnyRole(session, [
    'super_admin',
    'admin',
    'partner',
    'manager',
  ]);
  const allPeopleForCards = canAddTeamFromCard
    ? (await listActivePeopleOptions()).map((p) => ({
        id: p.id,
        initials: p.initials,
        firstName: p.firstName,
        lastName: p.lastName,
        band: p.band,
      }))
    : [];
  // Commercials gate — admin / super_admin / partner see contract
  // values + total in-flight value across the firm. Managers + staff
  // get the project list without dollar amounts (per-project P&L is
  // still gated separately on the detail page).
  const canSeeCommercials = hasAnyRole(session, [
    'super_admin',
    'admin',
    'partner',
  ]);
  // Per-session visibility toggle on top of the role gate — partners
  // hide commercials when running team meetings on the projects page
  // and flip them back on for private review.
  const commercialsVisible = canSeeCommercials && (await readCommercialsVisible());

  // Pull payment-state for archived rows so the kanban "closed · paid" footer
  // is accurate without a second round-trip per card. Only matters for the
  // archived bucket — skipping when scope excludes it.
  const archivedIds = rows
    .filter((r) => r.stage === 'archived')
    .map((r) => r.id);
  const archivedInvoices = archivedIds.length
    ? await prisma.invoice.findMany({
        where: { projectId: { in: archivedIds } },
        select: {
          projectId: true,
          status: true,
          amountTotal: true,
          paymentReceivedAmount: true,
        },
      })
    : [];
  const paidByProject = new Map<string, boolean>();
  for (const id of archivedIds) {
    const invs = archivedInvoices.filter((i) => i.projectId === id);
    const allCleared =
      invs.length === 0 ||
      invs.every(
        (i) => i.status === 'paid' || (i.paymentReceivedAmount ?? 0) >= i.amountTotal,
      );
    paidByProject.set(id, allCleared);
  }

  // Header summary line: "9 projects · 5 active · $3.95M in flight"
  const totalCount = rows.length;
  const activeCount = rows.filter(
    (r) => r.stage === 'kickoff' || r.stage === 'delivery' || r.stage === 'closing',
  ).length;
  const inFlightCents = rows
    .filter(
      (r) => r.stage === 'kickoff' || r.stage === 'delivery' || r.stage === 'closing',
    )
    .reduce((s, r) => s + r.contractValueCents, 0);

  return (
    <div className="space-y-6">
      {deletedFlag && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Project deleted.
        </div>
      )}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Projects</h1>
          <p className="text-sm text-ink-3">
            {totalCount} {totalCount === 1 ? 'project' : 'projects'} · {activeCount} active
            {commercialsVisible && inFlightCents > 0 && (
              <>
                {' '}
                · <span className="font-medium text-ink-2">{formatMoneyShort(inFlightCents)}</span>{' '}
                in flight
              </>
            )}
            {' '}·{' '}
            {session.person.roles.some((r) =>
              ['super_admin', 'admin', 'partner'].includes(r),
            )
              ? 'all engagements visible'
              : session.person.roles.includes('manager')
                ? 'projects you manage'
                : 'projects you are on'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSeeCommercials && (
            <CommercialsToggle visible={commercialsVisible} path="/projects" />
          )}
          <ViewToggle current={view} q={q} stage={stage} active={active} />
          <a
            href={`/api/reports/projects${buildQs({
              q,
              stage,
              active: active === undefined ? undefined : String(active),
            })}`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Download CSV
          </a>
          {canCreate && (
            <Button asChild>
              <Link href="/projects/new">+ New project</Link>
            </Button>
          )}
        </div>
      </header>

      <form
        action="/projects"
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3"
      >
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search code, name, or client…"
          className="min-w-[240px] max-w-md"
        />
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <span>Stage</span>
          <select
            name="stage"
            defaultValue={stage ?? ''}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">All</option>
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <span>Active</span>
          <select
            name="active"
            defaultValue={active === true ? 'true' : active === false ? 'false' : ''}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Archived</option>
          </select>
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        <input type="hidden" name="view" value={view} />
        {(q || stage || active !== undefined) && (
          <Button type="button" asChild variant="ghost" size="sm">
            <Link href={`/projects${buildQs({ view })}`}>Clear</Link>
          </Button>
        )}
        <span className="ml-auto text-xs text-ink-3">
          {rows.length} {rows.length === 1 ? 'match' : 'matches'}
        </span>
      </form>

      {view === 'kanban' && (
        <ProjectsKanban
          projects={rows.map((r) => projectToKanbanCard(r, paidByProject))}
          canCreate={canCreate}
          canMove={canMoveAny}
          canAddTeam={canAddTeamFromCard}
          allPeople={allPeopleForCards}
        />
      )}
      {view === 'grid' && (
        <ProjectsGrid
          rows={rows}
          paidByProject={paidByProject}
          canSeeCommercials={commercialsVisible}
          canAddTeam={canAddTeamFromCard}
          allPeople={allPeopleForCards}
        />
      )}
      {view === 'table' && (
        <ProjectsTable rows={rows} canSeeCommercials={commercialsVisible} />
      )}

      {/* Completed-projects archive grouped by AU FY. Built off the
          same `rows` (no extra query) but filtered to archived only.
          FY26 (current) expands by default; older years stay
          collapsed until reviewed. Gated on commercialsVisible so
          totals don't flash during team discussions. */}
      {commercialsVisible && (
        <CompletedByFiscalYear rows={rows} />
      )}
    </div>
  );
}

/**
 * Completed-projects archive.
 *
 * Layout:
 *   - "Recent closed" — always visible (not collapsed) showing the 5 most
 *     recently closed engagements. This is what TT + partners reach for
 *     day-to-day; keeping it open avoids one click per visit.
 *   - "Older by fiscal year" — everything else, one collapsible section
 *     per AU FY (newest first, current FY included if any of its closed
 *     projects fell out of the top-5). Each FY collapses by default so
 *     the historical tail doesn't balloon the page.
 *
 * "Recently closed" is ordered by `actualEndDate` → `endDate` → `startDate`
 * (falling back through the date fields we actually have), then `createdAt`
 * as a final tiebreaker via id-lex. Historical shell-backfill rows without
 * dates land in their FY bucket but don't push more recent rows out of
 * the top-5 slot.
 */
function CompletedByFiscalYear({ rows }: { rows: ProjectListRow[] }) {
  const RECENT_LIMIT = 5;
  const archived = rows.filter((r) => r.stage === 'archived');
  if (archived.length === 0) return null;
  const currentFy = auFyOf(new Date());

  // Sort by best-available closure date DESC. Rows with no closure date at
  // all sort to the end so shell-backfilled historicals don't crowd out
  // genuinely recent closures.
  const closureDate = (r: ProjectListRow): number => {
    const d = r.actualEndDate ?? r.endDate ?? r.startDate;
    return d ? d.getTime() : 0;
  };
  const sorted = archived.slice().sort((a, b) => closureDate(b) - closureDate(a));
  const recent = sorted.slice(0, RECENT_LIMIT);
  const recentIds = new Set(recent.map((r) => r.id));
  const rest = archived.filter((r) => !recentIds.has(r.id));

  // Bucket the "rest" by FY. Null-date rows go to their client's presumed
  // FY (currentFy) — the reconcile assistant will move them once dates
  // are backfilled.
  const FIRST_FY = 2021;
  const groups = new Map<number, ProjectListRow[]>();
  for (const r of rest) {
    const fy = r.startDate ? auFyOf(r.startDate) : currentFy;
    const arr = groups.get(fy) ?? [];
    arr.push(r);
    groups.set(fy, arr);
  }
  const years: number[] = [];
  for (let fy = currentFy; fy >= FIRST_FY; fy--) years.push(fy);

  const recentTotal = recent.reduce((s, p) => s + p.contractValueCents, 0);

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold text-ink">Completed projects</h2>
        <p className="text-[11px] text-ink-3">
          Latest {RECENT_LIMIT} closures shown up front; everything else
          collapses into per-FY sections below.
        </p>
      </header>

      {/* Recent — always visible, no <details> wrapper. */}
      <div className="rounded-lg border border-line bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3 text-sm">
          <span className="font-semibold text-ink">
            Recently closed
            <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-3">
              latest {recent.length}
            </span>
          </span>
          <span className="text-ink-3">
            <span className="font-medium tabular-nums text-ink-2">
              {formatMoneyShort(recentTotal)}
            </span>{' '}
            contract value
          </span>
        </div>
        <ClosedProjectsTable projs={recent} sortBy="date" />
      </div>

      {/* Older — per-FY collapsibles. */}
      {rest.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Older by fiscal year
          </h3>
          {years.map((fy) => {
            const projs = groups.get(fy) ?? [];
            if (projs.length === 0) return null;
            const total = projs.reduce((s, p) => s + p.contractValueCents, 0);
            return (
              <details
                key={fy}
                className="rounded-lg border border-line bg-card"
              >
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-semibold text-ink">
                    {auFyLabel(fy)}
                    {fy === currentFy && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-3">
                        current
                      </span>
                    )}
                  </span>
                  <span className="text-ink-3">
                    {projs.length} {projs.length === 1 ? 'project' : 'projects'} ·{' '}
                    <span className="font-medium tabular-nums text-ink-2">
                      {formatMoneyShort(total)}
                    </span>
                  </span>
                </summary>
                <div className="border-t border-line">
                  <ClosedProjectsTable projs={projs} sortBy="value" />
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Shared body for the "Recently closed" block and each per-FY section.
 * `sortBy="date"` orders by best-available closure date DESC (used up top);
 * `sortBy="value"` orders by contract value DESC (used in historical FYs,
 * where date resolution is often just a placeholder).
 */
function ClosedProjectsTable({
  projs,
  sortBy,
}: {
  projs: ProjectListRow[];
  sortBy: 'date' | 'value';
}) {
  const closureDate = (r: ProjectListRow): number => {
    const d = r.actualEndDate ?? r.endDate ?? r.startDate;
    return d ? d.getTime() : 0;
  };
  const sorted = projs.slice().sort((a, b) => {
    if (sortBy === 'date') return closureDate(b) - closureDate(a);
    return b.contractValueCents - a.contractValueCents;
  });
  return (
    <table className="w-full text-sm">
      <thead className="bg-surface-subtle/40 text-[11px] uppercase tracking-wide text-ink-3">
        <tr>
          <th className="px-4 py-2 text-left">Code</th>
          <th className="px-4 py-2 text-left">Client</th>
          <th className="px-4 py-2 text-left">Project</th>
          <th className="px-4 py-2 text-right">Contract</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.id} className="border-t border-line">
            <td className="px-4 py-2">
              <Link
                href={`/projects/${p.code}`}
                className="font-mono text-ink hover:underline"
              >
                {p.code}
              </Link>
            </td>
            <td className="px-4 py-2 text-ink-2">{p.client.legalName}</td>
            <td className="px-4 py-2 text-ink-2">{p.name}</td>
            <td className="px-4 py-2 text-right tabular-nums text-ink-2">
              {formatMoneyShort(p.contractValueCents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ViewToggle({
  current,
  q,
  stage,
  active,
}: {
  current: ViewMode;
  q: string;
  stage: ProjectStage | undefined;
  active: boolean | undefined;
}) {
  const baseQs = buildQs({
    q: q || undefined,
    stage,
    active: active === undefined ? undefined : String(active),
  });
  function href(v: ViewMode) {
    const sep = baseQs.startsWith('?') ? '&' : '?';
    return `/projects${baseQs}${sep}view=${v}`;
  }
  return (
    <div className="flex overflow-hidden rounded-md border border-line text-sm">
      {(['kanban', 'grid', 'table'] as const).map((v) => (
        <Link
          key={v}
          href={href(v)}
          className={`px-3 py-1.5 capitalize ${
            current === v
              ? 'bg-brand text-brand-ink'
              : 'text-ink-3 hover:bg-surface-hover'
          }`}
        >
          {v}
        </Link>
      ))}
    </div>
  );
}

function projectToKanbanCard(
  r: ProjectListRow,
  paidByProject: Map<string, boolean>,
) {
  let weekIndex = 0;
  let weekTotal = 0;
  let progressPct = 0;
  if (r.startDate && r.endDate) {
    const total = weeksBetween(r.startDate, r.endDate);
    weekTotal = total;
    if (r.stage === 'archived' && r.actualEndDate) {
      weekIndex = total;
      progressPct = 100;
    } else {
      const elapsed = Math.max(
        0,
        Math.min(total, weeksBetween(r.startDate, new Date())),
      );
      weekIndex = elapsed;
      progressPct = total > 0 ? Math.round((elapsed / total) * 100) : 0;
    }
  }
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    clientLegalName: r.client.legalName,
    stage: r.stage,
    contractValueCents: r.contractValueCents,
    startDateIso: r.startDate ? r.startDate.toISOString() : null,
    endDateIso: r.endDate ? r.endDate.toISOString() : null,
    actualEndDateIso: r.actualEndDate ? r.actualEndDate.toISOString() : null,
    team: r.team.map((p) => ({
      id: p.id,
      initials: p.initials,
      firstName: p.firstName,
      lastName: p.lastName,
      headshotUrl: p.headshotUrl,
    })),
    weekIndex,
    weekTotal,
    progressPct,
    qcStatus: r.qcStatus,
    paid: paidByProject.get(r.id) ?? false,
    sortOrder: r.sortOrder,
  };
}

/**
 * Internal FH projects (FHP series — FHP000 catch-all, primer
 * development, social media, brand work, etc) split into a separate
 * band so they don't compete visually with paying-client engagements.
 * Code prefix is the discriminator; the three pure-overhead expense
 * buckets (FHB / FHO / FHX) are already filtered out by `listProjects`.
 */
function isInternalProject(code: string): boolean {
  return code.startsWith('FHP');
}

function partitionByKind(rows: ProjectListRow[]): {
  client: ProjectListRow[];
  internal: ProjectListRow[];
} {
  return {
    client: rows.filter((r) => !isInternalProject(r.code)),
    internal: rows.filter((r) => isInternalProject(r.code)),
  };
}

function ProjectsGrid({
  rows,
  paidByProject,
  canSeeCommercials,
  canAddTeam,
  allPeople,
}: {
  rows: ProjectListRow[];
  paidByProject: Map<string, boolean>;
  canSeeCommercials: boolean;
  canAddTeam: boolean;
  allPeople: CardPersonOption[];
}) {
  if (rows.length === 0) {
    return <EmptyState />;
  }
  const { client, internal } = partitionByKind(rows);
  return (
    <div className="space-y-6">
      <ProjectsGridSection
        title="Client projects"
        subtitle="Engagements with paying clients."
        rows={client}
        paidByProject={paidByProject}
        canSeeCommercials={canSeeCommercials}
        canAddTeam={canAddTeam}
        allPeople={allPeople}
      />
      <ProjectsGridSection
        title="Internal projects · FHP series"
        subtitle="Standing + episodic FH initiatives — primers, social, brand work."
        rows={internal}
        paidByProject={paidByProject}
        canSeeCommercials={canSeeCommercials}
        canAddTeam={canAddTeam}
        allPeople={allPeople}
        emptyHint="No internal projects yet."
      />
    </div>
  );
}

function ProjectsGridSection({
  title,
  subtitle,
  rows,
  paidByProject,
  canSeeCommercials,
  canAddTeam,
  allPeople,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  rows: ProjectListRow[];
  paidByProject: Map<string, boolean>;
  canSeeCommercials: boolean;
  canAddTeam: boolean;
  allPeople: CardPersonOption[];
  emptyHint?: string;
}) {
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {title}
            <span className="ml-2 text-xs tabular-nums text-ink-3">
              {rows.length}
            </span>
          </h2>
          <p className="text-[11px] text-ink-3">{subtitle}</p>
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-line bg-surface-subtle/30 p-6 text-center text-xs text-ink-3">
          {emptyHint ?? 'Empty.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const card = projectToKanbanCard(r, paidByProject);
            const dotColor =
              card.qcStatus === 'red'
                ? 'bg-status-red'
                : card.qcStatus === 'amber'
                  ? 'bg-status-amber'
                  : 'bg-status-green';
            const teamIds = new Set(r.team.map((t) => t.id));
            const addOptions = canAddTeam
              ? allPeople.filter((p) => !teamIds.has(p.id))
              : [];
            return (
              <Card key={r.id} className="flex flex-col p-4">
                {/* Reflowed header — client legal name on top
                     (regular), then project code (bold) + project name
                     (bold) inline. Stage badge + QC dot move to the
                     right column so the title can breathe. */}
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/projects/${r.code}`}
                    className="block min-w-0 flex-1 hover:underline"
                  >
                    <div className="truncate text-xs text-ink-3">
                      {r.client.legalName}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold text-ink">
                        {r.code}
                      </span>
                      <span className="text-sm font-semibold text-ink">
                        {r.name}
                      </span>
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    <Badge
                      variant={STAGE_VARIANT[r.stage]}
                      className="text-[10px] capitalize"
                    >
                      {STAGE_LABEL[r.stage]}
                    </Badge>
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${dotColor}`}
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  {canSeeCommercials && (
                    <>
                      <div className="text-ink-3">Contract</div>
                      <div className="text-right tabular-nums text-ink">
                        {formatMoneyShort(r.contractValueCents)}
                      </div>
                    </>
                  )}
                  <div className="text-ink-3">Weeks</div>
                  <div className="text-right tabular-nums text-ink-2">
                    {card.weekTotal > 0
                      ? `${card.weekIndex} / ${card.weekTotal}`
                      : '—'}
                  </div>
                  <div className="text-ink-3">Lead</div>
                  <div className="text-right text-ink-2">
                    {r.primaryPartner.firstName} {r.primaryPartner.lastName}
                  </div>
                </div>

                <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
                  <div
                    className="h-full bg-status-green"
                    style={{ width: `${Math.min(100, card.progressPct)}%` }}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center">
                    <div className="flex -space-x-2">
                      {r.team.slice(0, 5).map((p) => (
                        <PersonAvatar
                          key={p.id}
                          className="h-6 w-6 border-2 border-card bg-surface-elev"
                          fallbackClassName="text-[9px]"
                          initials={p.initials}
                          headshotUrl={p.headshotUrl}
                          title={`${p.firstName} ${p.lastName}`}
                        />
                      ))}
                      {r.team.length > 5 && (
                        <span className="ml-2 self-center text-[10px] text-ink-3">
                          +{r.team.length - 5}
                        </span>
                      )}
                    </div>
                    {canAddTeam && (
                      <CardAddMember projectId={r.id} options={addOptions} />
                    )}
                  </div>
                  <Link
                    href={`/projects/${r.code}`}
                    className="text-xs text-brand hover:underline"
                  >
                    Open →
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProjectsTable({
  rows,
  canSeeCommercials,
}: {
  rows: ProjectListRow[];
  canSeeCommercials: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState />;
  }
  const { client, internal } = partitionByKind(rows);
  // Render one Card-wrapped Table with two body sections — a row-
  // group header for client projects, then the same for the internal
  // FHP series. Keeps the column alignment identical across bands.
  const colCount = canSeeCommercials ? 7 : 6;
  return (
    <Card className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Client / Project</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Partner</TableHead>
            <TableHead>Manager</TableHead>
            {canSeeCommercials && (
              <TableHead className="text-right">Contract</TableHead>
            )}
            <TableHead>Window</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <ProjectsTableSection
            title="Client projects"
            subtitle="Engagements with paying clients."
            rows={client}
            canSeeCommercials={canSeeCommercials}
            colSpan={colCount}
          />
          <ProjectsTableSection
            title="Internal projects · FHP series"
            subtitle="Standing + episodic FH initiatives."
            rows={internal}
            canSeeCommercials={canSeeCommercials}
            colSpan={colCount}
            emptyHint="No internal projects yet."
          />
        </TableBody>
      </Table>
    </Card>
  );
}

function ProjectsTableSection({
  title,
  subtitle,
  rows,
  canSeeCommercials,
  colSpan,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  rows: ProjectListRow[];
  canSeeCommercials: boolean;
  colSpan: number;
  emptyHint?: string;
}) {
  return (
    <>
      <TableRow className="bg-surface-subtle/60 hover:bg-surface-subtle/60">
        <TableCell colSpan={colSpan} className="py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">
              {title}
              <span className="ml-2 tabular-nums text-ink-3">{rows.length}</span>
            </span>
            <span className="text-[11px] text-ink-3">{subtitle}</span>
          </div>
        </TableCell>
      </TableRow>
      {rows.length === 0 ? (
        <TableRow>
          <TableCell
            colSpan={colSpan}
            className="py-3 text-center text-xs text-ink-3"
          >
            {emptyHint ?? 'Empty.'}
          </TableCell>
        </TableRow>
      ) : (
        rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <Link
                href={`/projects/${p.code}`}
                className="font-mono text-ink hover:underline"
              >
                {p.code}
              </Link>
            </TableCell>
            <TableCell>
              <div className="font-medium text-ink">{p.client.legalName}</div>
              <div className="text-xs text-ink-3">{p.name}</div>
            </TableCell>
            <TableCell>
              <Badge variant={STAGE_VARIANT[p.stage]} className="capitalize">
                {STAGE_LABEL[p.stage]}
              </Badge>
            </TableCell>
            <TableCell>
              <MiniPerson p={p.primaryPartner} />
            </TableCell>
            <TableCell>
              <MiniPerson p={p.manager} />
            </TableCell>
            {canSeeCommercials && (
              <TableCell className="text-right tabular-nums">
                {formatMoney(p.contractValueCents)}
              </TableCell>
            )}
            <TableCell className="text-xs tabular-nums text-ink-3">
              {p.startDate
                ? p.startDate.toLocaleDateString('en-AU')
                : <span className="text-ink-4">—</span>}
              {' → '}
              {p.actualEndDate
                ? p.actualEndDate.toLocaleDateString('en-AU')
                : p.endDate
                  ? p.endDate.toLocaleDateString('en-AU')
                  : <span className="text-ink-4">—</span>}
            </TableCell>
          </TableRow>
        ))
      )}
    </>
  );
}

function EmptyState() {
  return (
    <Card className="p-12 text-center text-sm text-ink-3">
      No projects match the current filters. Try clearing them or creating a new
      project.
    </Card>
  );
}

function MiniPerson({
  p,
}: {
  p: {
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  };
}) {
  return (
    <div className="flex items-center gap-2">
      <PersonAvatar
  className="h-6 w-6"
  fallbackClassName="text-[10px]"
  initials={p.initials}
  headshotUrl={p.headshotUrl}
/>
      <span className="text-sm text-ink-2">
        {p.firstName} {p.lastName}
      </span>
    </div>
  );
}
