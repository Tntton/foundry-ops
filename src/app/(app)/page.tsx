import Link from 'next/link';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import {
  computeManagerDashboard,
  type ManagerDashboard,
  type ProjectQcCard,
  type TeamWeekRow,
} from '@/server/manager-dashboard';
import {
  computeBudgetWatch,
  type BudgetWatchRow,
  type BudgetWatch,
} from '@/server/reports/budget-watch';
import {
  computeAdminExpenseReport,
  type AdminExpenseReport,
} from '@/server/reports/admin-expense-report';
import {
  computeAdminBdPipeline,
  type AdminBdPipeline,
} from '@/server/reports/admin-bd-pipeline';
import {
  listInvoiceSuggestions,
  type InvoiceSuggestion,
} from '@/server/invoice-suggestions';
import { InvoiceSuggestionsCard } from '@/components/invoice-suggestions-card';
import { hasCapability } from '@/server/capabilities';
import { listProjects, type ProjectListRow } from '@/server/projects';
import { PersonAvatar } from '@/components/person-avatar';
import { listUserUpdates } from '@/server/user-updates';
import { listStaffPendingActions } from '@/server/staff-actions';
import { listLeaderPendingActions } from '@/server/leader-actions';
import {
  getDashboardActionPrefs,
  countVisibleActions,
} from '@/server/dashboard-prefs';
import { LatestUpdatesCard } from './dashboard/latest-updates-card';
import { StaffActionStrip } from './dashboard/staff-action-strip';
import { LeaderActionStrip } from './dashboard/leader-action-strip';
import { FeedbackPipelineCardView } from './dashboard/feedback-pipeline-card';
import { getFeedbackPipeline } from '@/server/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Greeting for the staff dashboard header. Time-of-day aware so the
 * line reads natural ("Good morning", "Afternoon" etc.) instead of
 * the static "my week" we had before. Server-rendered using the host
 * timezone — close enough for AU/NZ team, which is the audience.
 */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'late night';
  if (h < 12) return 'good morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'late night';
}

function formatMoney(cents: number): string {
  if (cents === 0) return '$0';
  if (Math.abs(cents) >= 100_000_00) {
    return `$${(cents / 100_000_00).toFixed(1)}m`;
  }
  if (Math.abs(cents) >= 100_00) {
    return `$${Math.round(cents / 100_000)}k`;
  }
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { scope?: string };
}) {
  const session = await getSession();
  if (!session) {
    return (
      <div className="p-10 text-center text-sm text-ink-3">
        Sign in to view the dashboard.
      </div>
    );
  }

  const canSeeAllFirm = hasAnyRole(session, ['super_admin', 'admin', 'partner']);
  // Admin (super_admin / admin) sees the firm-overhead expense report
  // — bills + expenses tagged to FHB / FHO / FHX as a vendor table.
  // Partners + managers don't see this card; they get the project
  // tiles only (which already exclude the buckets).
  const isAdmin = hasAnyRole(session, ['super_admin', 'admin']);
  const isSuperAdmin = hasAnyRole(session, ['super_admin']);
  const isLeader = hasAnyRole(session, ['super_admin', 'admin', 'partner', 'associate_partner', 'manager']);
  const scope: 'mine' | 'all' =
    canSeeAllFirm && searchParams.scope === 'all' ? 'all' : 'mine';
  // Fan out the dashboard's reads in parallel. Earlier comments
  // mention sequential awaits to spare the pgbouncer pool, but we're
  // on Supabase Pro now (large pool) and the page was taking 20+s.
  const [
    data,
    budgetWatch,
    adminExpenseReport,
    adminBdPipeline,
    invoiceSuggestions,
    leaderPayload,
    myUpdates,
    staffProjects,
    feedbackPipeline,
  ] = await Promise.all([
    computeManagerDashboard(session, scope),
    canSeeAllFirm ? computeBudgetWatch() : Promise.resolve(null),
    isAdmin ? computeAdminExpenseReport() : Promise.resolve(null),
    isAdmin ? computeAdminBdPipeline() : Promise.resolve(null),
    isSuperAdmin ? listInvoiceSuggestions(session) : Promise.resolve(null),
    isLeader ? listLeaderPendingActions(session) : Promise.resolve(null),
    listUserUpdates(session.person.id, 30),
    isLeader ? Promise.resolve([] as ProjectListRow[]) : listProjects(session, { active: true }),
    isAdmin ? getFeedbackPipeline() : Promise.resolve(null),
  ]) as [
    ManagerDashboard,
    BudgetWatch | null,
    AdminExpenseReport | null,
    AdminBdPipeline | null,
    InvoiceSuggestion[] | null,
    Awaited<ReturnType<typeof listLeaderPendingActions>> | null,
    Awaited<ReturnType<typeof listUserUpdates>>,
    ProjectListRow[],
    Awaited<ReturnType<typeof getFeedbackPipeline>> | null,
  ];
  const canDraftInvoices = hasCapability(session, 'invoice.create');

  // Highest-privilege role label for tile gating. Super_admin maps
  // to admin's tile set (they see the same firm-wide surface);
  // partner + associate_partner share the partner tile set (BD,
  // invoice approval); standalone manager gets the narrowest.
  const leaderRole: 'manager' | 'partner' | 'admin' = isAdmin
    ? 'admin'
    : hasAnyRole(session, ['partner', 'associate_partner'])
      ? 'partner'
      : 'manager';

  // Staff (no leader role) get a focused dashboard: quick-action
  // tiles + pending-action strip + projects + updates feed. Skips
  // utilisation %, QC tiles with margin, budget-watch, team-week,
  // firm-overview, alerts — none of which they have permission for
  // or need. The action strip is the headline: a busy consultant
  // opens the app and sees what they owe, in priority order, in
  // one tap.
  if (!isLeader) {
    const pending = await listStaffPendingActions(session.person.id);
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-3">
              {data.context.selfInitials} · {greeting()}
            </p>
            <h1 className="text-xl font-semibold text-ink">
              {pending.length > 0
                ? `${pending.length} thing${pending.length === 1 ? '' : 's'} to clear`
                : 'You’re all clear'}
            </h1>
          </div>
        </header>
        <StaffActionStrip
          pending={pending}
          initials={data.context.selfInitials}
        />
        <StaffActiveProjectsCard projects={staffProjects} />
        <LatestUpdatesCard updates={myUpdates} />
      </div>
    );
  }

  // Leader dashboard. Load this leader's action-group hide/snooze prefs so
  // the strip can group + suppress, and the headline counts only what's
  // actually visible. `now` is fixed once so snooze-expiry is stable.
  const now = new Date();
  const actionPrefs = leaderPayload
    ? await getDashboardActionPrefs(session.person.id)
    : {};
  const leaderVisibleCount = leaderPayload
    ? countVisibleActions(leaderPayload.actions, actionPrefs, now)
    : 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-3">
            {data.context.selfInitials} · {greeting()} · {data.topStats.projectsLed}{' '}
            {data.topStats.projectsLed === 1 ? 'project' : 'projects'} led
          </p>
          <h1 className="text-xl font-semibold text-ink">
            {/* Role-aware header — was a static "Manager dashboard"
                regardless of who was viewing, which read wrong for
                partners + admins. Headline now matches the pending-
                action count when there's work to clear; falls back
                to a generic "Dashboard" once everything's done. */}
            {leaderPayload && leaderVisibleCount > 0
              ? `${leaderVisibleCount} thing${leaderVisibleCount === 1 ? '' : 's'} to clear`
              : leaderRole === 'admin'
                ? 'Admin dashboard'
                : leaderRole === 'partner'
                  ? 'Partner dashboard'
                  : 'Manager dashboard'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSeeAllFirm && (
            <div className="flex overflow-hidden rounded-md border border-line text-xs">
              <Link
                href="/?scope=mine"
                className={`px-3 py-1.5 ${scope === 'mine' ? 'bg-brand text-brand-ink' : 'text-ink-3 hover:bg-surface-hover'}`}
              >
                My projects
              </Link>
              <Link
                href="/?scope=all"
                className={`px-3 py-1.5 ${scope === 'all' ? 'bg-brand text-brand-ink' : 'text-ink-3 hover:bg-surface-hover'}`}
              >
                All firm
              </Link>
            </div>
          )}
          {hasAnyRole(session, ['super_admin', 'admin', 'partner']) && (
            <Button asChild size="sm">
              <Link href="/projects/new">+ New project</Link>
            </Button>
          )}
        </div>
      </header>

      {leaderPayload && (
        <LeaderActionStrip
          pending={leaderPayload.actions}
          counts={leaderPayload.counts}
          role={leaderRole}
          prefs={actionPrefs}
          now={now}
        />
      )}

      <LatestUpdatesCard updates={myUpdates} />

      {/* Admin-only: feedback pipeline summary so TT can scan
          pending decisions + recently shipped tickets without
          leaving the dashboard. */}
      {isAdmin && feedbackPipeline && (
        <FeedbackPipelineCardView pipeline={feedbackPipeline} />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <TopStats stats={data.topStats} />
          {invoiceSuggestions && (
            <InvoiceSuggestionsCard
              suggestions={invoiceSuggestions}
              canCreate={canDraftInvoices}
              emptyHint="No invoices pending. Every active project either has invoices in flight or no overdue milestone."
            />
          )}
          <OperationalQcSection projects={data.projects} />
          {adminBdPipeline && (
            <AdminBdPipelineSection data={adminBdPipeline} />
          )}
          {adminExpenseReport && (
            <AdminExpenseReportSection data={adminExpenseReport} />
          )}
          {budgetWatch && <BudgetWatchSection data={budgetWatch} />}
          <TeamWeekSection
            rows={data.teamWeek.rows}
            columns={data.teamWeek.projectColumns}
          />
        </div>
        <aside className="space-y-4">
          <FirmOverviewCard firm={data.firmOverview} />
          <ThisWeekCard projects={data.projects} />
          <AlertsCard alerts={data.alerts} />
        </aside>
      </div>
    </div>
  );
}

const STAGE_VARIANT_STAFF: Record<string, 'amber' | 'green' | 'blue' | 'outline'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};

/**
 * Active-projects list for pure-staff dashboard. No commercials —
 * just code, name, stage, partner, and a tap-target into the project
 * detail page. Empty state nudges the staffer to flag missing
 * allocations to their manager.
 */
function StaffActiveProjectsCard({ projects }: { projects: ProjectListRow[] }) {
  const active = projects.filter((p) => p.stage !== 'archived');
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
          My active projects
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3 pt-0">
        {active.length === 0 ? (
          <p className="px-1 py-3 text-xs text-ink-3">
            You&apos;re not on any active projects right now. If that&apos;s
            wrong, ask your partner / manager to add you.
          </p>
        ) : (
          active.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.code}`}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-elev px-3 py-2 text-sm hover:bg-surface-hover"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-ink-3">{p.code}</span>
                  <span className="font-medium text-ink">{p.name}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-3">
                  {p.client.legalName}
                  {p.primaryPartner && (
                    <>
                      {' · '}
                      <span>
                        Partner: {p.primaryPartner.firstName}{' '}
                        {p.primaryPartner.lastName}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Badge
                variant={STAGE_VARIANT_STAFF[p.stage] ?? 'outline'}
                className="capitalize"
              >
                {p.stage}
              </Badge>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function TopStats({ stats }: { stats: ManagerDashboard['topStats'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile
        label="Projects led"
        value={String(stats.projectsLed)}
        sub={`${stats.projectsActive} active · ${stats.projectsWrapping} wrapping`}
      />
      <StatTile
        label="Team utilisation"
        value={
          stats.teamUtilisationPct === null ? '—' : `${stats.teamUtilisationPct}%`
        }
        sub={
          stats.teamUtilisationPct === null
            ? 'No FT capacity'
            : stats.teamUtilisationPct >= stats.teamUtilisationTargetPct
              ? `above target ${stats.teamUtilisationTargetPct}%`
              : `below target ${stats.teamUtilisationTargetPct}%`
        }
        tone={
          stats.teamUtilisationPct === null
            ? 'neutral'
            : stats.teamUtilisationPct >= stats.teamUtilisationTargetPct
              ? 'green'
              : 'amber'
        }
      />
      <StatTile
        label="Open risks"
        value={String(stats.openRisks)}
        sub={[
          stats.risksByCategory.margin
            ? `${stats.risksByCategory.margin} margin`
            : null,
          stats.risksByCategory.delivery
            ? `${stats.risksByCategory.delivery} delivery`
            : null,
          stats.risksByCategory.timesheet
            ? `${stats.risksByCategory.timesheet} timesheet`
            : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'no flagged risks'}
        tone={stats.openRisks === 0 ? 'green' : 'amber'}
      />
      <StatTile
        label="Avg margin"
        value={stats.avgMarginPct === null ? '—' : `${stats.avgMarginPct}%`}
        sub={`target ${stats.marginTargetPct}%+`}
        tone={
          stats.avgMarginPct === null
            ? 'neutral'
            : stats.avgMarginPct >= stats.marginTargetPct
              ? 'green'
              : 'amber'
        }
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
}) {
  const subColor =
    tone === 'green'
      ? 'text-status-green'
      : tone === 'amber'
        ? 'text-status-amber'
        : tone === 'red'
          ? 'text-status-red'
          : 'text-ink-3';
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
          {label}
        </div>
        <div className="text-3xl font-semibold tabular-nums text-ink">{value}</div>
        <div className={`text-[11px] ${subColor}`}>{sub}</div>
      </CardContent>
    </Card>
  );
}

function OperationalQcSection({ projects }: { projects: ProjectQcCard[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Operational QC · all my projects</CardTitle>
          <p className="text-xs text-ink-3">
            financial + delivery + team health, at a glance
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {projects.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">
            No active projects in scope. Switch to All firm if you&apos;re looking
            for someone else&apos;s.
          </p>
        ) : (
          projects.map((p) => <QcProjectCard key={p.id} card={p} />)
        )}
      </CardContent>
    </Card>
  );
}

function QcProjectCard({ card }: { card: ProjectQcCard }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {card.code}
            </Badge>
            <Link
              href={`/projects/${card.code}`}
              className="font-semibold text-ink hover:underline"
            >
              {card.name}
            </Link>
            <Badge variant={STAGE_VARIANT[card.stage] ?? 'outline'}>
              {card.stage}
            </Badge>
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                card.qcStatus === 'green'
                  ? 'bg-status-green'
                  : card.qcStatus === 'amber'
                    ? 'bg-status-amber'
                    : 'bg-status-red'
              }`}
              title={`QC status: ${card.qcStatus}`}
            />
          </div>
          <div className="mt-1 text-xs text-ink-3">{card.subtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link href={`/projects/${card.code}`}>
              <span className="mr-1 text-status-green">✓</span> QC
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-8 text-xs">
            <Link href={`/projects/${card.code}`}>Open →</Link>
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Progress"
          value={`${card.progressPct}%`}
          tone={
            card.progressPct >= 80
              ? 'green'
              : card.progressPct >= 30
                ? 'neutral'
                : 'amber'
          }
        />
        <Metric
          label="Expense"
          value={`${card.expensePct}%`}
          tone={card.expenseTone}
        />
        <Metric
          label="Margin"
          value={`${card.marginPct}%`}
          tone={card.marginTone}
        />
        <Metric label="AR" value={formatMoney(card.arOutstandingCents)} />
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
        <div
          className={`h-full ${
            card.qcStatus === 'red'
              ? 'bg-status-red'
              : card.qcStatus === 'amber'
                ? 'bg-status-amber'
                : 'bg-status-green'
          }`}
          style={{ width: `${Math.min(100, card.progressPct)}%` }}
        />
      </div>

      {card.chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {card.chips.map((chip, i) => (
            <span
              key={`${card.id}:${i}`}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                chip.tone === 'red'
                  ? 'border-status-red bg-status-red-soft text-status-red'
                  : chip.tone === 'amber'
                    ? 'border-status-amber bg-status-amber-soft text-status-amber'
                    : chip.tone === 'green'
                      ? 'border-status-green bg-status-green-soft text-status-green'
                      : 'border-line text-ink-3'
              }`}
            >
              {chip.tone === 'amber' ? '⚠ ' : ''}
              {chip.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
}) {
  const cls =
    tone === 'green'
      ? 'text-status-green'
      : tone === 'amber'
        ? 'text-status-amber'
        : tone === 'red'
          ? 'text-status-red'
          : 'text-ink';
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div className={`text-base font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function TeamWeekSection({
  rows,
  columns,
}: {
  rows: TeamWeekRow[];
  columns: Array<{ id: string; code: string; name: string }>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Team across my projects · this week</CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link href="/resource-planning">Staffing grid →</Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">
            No-one allocated to your projects yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle text-ink-3">
                <tr className="border-y border-line">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide">
                    Member
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide">
                    Role
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.id}
                      className="px-3 py-2 text-right text-[10px] uppercase tracking-wide"
                      title={c.name}
                    >
                      {c.code}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide">
                    This wk
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide">
                    Util
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide">
                    TS status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tone =
                    r.timesheetStatus === 'missing'
                      ? 'amber'
                      : r.timesheetStatus === 'submitted'
                        ? 'green'
                        : r.timesheetStatus === 'approved'
                          ? 'green'
                          : r.timesheetStatus === 'mixed'
                            ? 'amber'
                            : 'outline';
                  const utilTone =
                    r.utilisationPct === null
                      ? 'text-ink-3'
                      : r.utilisationPct > 100
                        ? 'text-status-red'
                        : r.utilisationPct < 60
                          ? 'text-status-amber'
                          : 'text-status-green';
                  return (
                    <tr
                      key={r.personId}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/directory/people/${r.personId}`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <PersonAvatar
  className="h-7 w-7"
  fallbackClassName="text-[10px]"
  initials={r.initials}
  headshotUrl={r.headshotUrl}
/>
                          <span className="text-ink">
                            {r.firstName} {r.lastName}
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-3">{r.role}</td>
                      {columns.map((c) => {
                        const h = r.perProject[c.code] ?? 0;
                        return (
                          <td
                            key={c.id}
                            className={`px-3 py-2 text-right tabular-nums ${
                              h > 0 ? 'text-ink' : 'text-ink-4'
                            }`}
                          >
                            {h > 0 ? `${h.toFixed(1)}h` : '0h'}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                        {r.totalHours.toFixed(1)}h
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${utilTone}`}
                      >
                        {r.utilisationPct === null
                          ? '—'
                          : `${r.utilisationPct}%`}
                      </td>
                      <td className="px-3 py-2">
                        {r.timesheetStatus === 'missing' ? (
                          <Badge variant="amber" className="text-[10px]">
                            • {r.missingDays} day{r.missingDays === 1 ? '' : 's'}{' '}
                            missing
                          </Badge>
                        ) : (
                          <Badge variant={tone} className="text-[10px]">
                            • {r.timesheetStatus}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Admin-only BD pipeline summary. Mirrors the firm-overhead expense
 * report shape: per-stage tile strip + a top-N in-flight list ranked
 * by weighted value. Click-through routes to /bd or the deal detail.
 */
function AdminBdPipelineSection({ data }: { data: AdminBdPipeline }) {
  const STAGE_VARIANT: Record<string, 'amber' | 'green' | 'blue' | 'outline'> = {
    lead: 'outline',
    qualifying: 'amber',
    proposal: 'blue',
    negotiation: 'green',
  };
  const STAGE_LABEL: Record<string, string> = {
    lead: 'Lead',
    qualifying: 'Qualifying',
    proposal: 'Proposal',
    negotiation: 'Negotiation',
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>BD pipeline</CardTitle>
          <p className="mt-1 text-xs text-ink-3">
            In-flight deals only. Weighted = expected × probability.
            Closed (won / lost) tracked over the last 90 days.
          </p>
        </div>
        <div className="text-right text-xs">
          <div className="font-mono tabular-nums text-ink">
            {formatMoney(data.totals.inFlightWeightedCents)}
          </div>
          <div className="text-ink-3">
            {data.totals.inFlightCount}{' '}
            {data.totals.inFlightCount === 1 ? 'deal' : 'deals'} · weighted
          </div>
          <div className="mt-0.5 text-[10px] text-ink-3">
            {data.totals.won90d} won / {data.totals.lost90d} lost · 90d
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          {(['lead', 'qualifying', 'proposal', 'negotiation'] as const).map(
            (s) => (
              <div
                key={s}
                className="rounded-md border border-line bg-surface-subtle/40 px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-wide text-ink-3">
                  {STAGE_LABEL[s]}
                  <span className="ml-1 tabular-nums">
                    · {data.totals.perStage[s].count}
                  </span>
                </div>
                <div className="mt-1 font-mono tabular-nums text-ink">
                  {formatMoney(data.totals.perStage[s].weightedCents)}
                </div>
                <div className="text-[10px] text-ink-3">
                  raw {formatMoney(data.totals.perStage[s].expectedCents)}
                </div>
              </div>
            ),
          )}
        </div>
        {data.rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-line bg-surface-subtle/40 px-3 py-4 text-center text-xs text-ink-3">
            No in-flight deals — pipeline is empty.{' '}
            <Link href="/bd/new" className="text-brand hover:underline">
              + Add a deal
            </Link>
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle/60 text-[11px] uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Deal</th>
                  <th className="px-3 py-1.5 text-left font-medium">Stage</th>
                  <th className="px-3 py-1.5 text-left font-medium">Owner</th>
                  <th className="px-3 py-1.5 text-right font-medium">Weighted</th>
                  <th className="px-3 py-1.5 text-right font-medium">Prob.</th>
                  <th className="px-3 py-1.5 text-left font-medium">Target close</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, 12).map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-3 py-1.5 text-ink">
                      <Link
                        href={`/bd/${r.id}`}
                        className="hover:underline"
                      >
                        <span className="font-mono text-xs text-ink-3">
                          {r.code}
                        </span>{' '}
                        <span className="font-medium">{r.name}</span>
                        <span className="ml-1 text-xs text-ink-3">
                          · {r.clientLabel}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge variant={STAGE_VARIANT[r.stage]}>
                        {STAGE_LABEL[r.stage]}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-ink-2">
                      {r.ownerInitials}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">
                      {formatMoney(r.weightedCents)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-ink-3">
                      {r.probability}%
                    </td>
                    <td className="px-3 py-1.5 text-xs tabular-nums text-ink-3">
                      {r.targetCloseIso
                        ? new Date(r.targetCloseIso).toLocaleDateString('en-AU')
                        : `${r.ageDays}d in pipe`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length > 12 && (
              <div className="border-t border-line bg-surface-subtle/40 px-3 py-1.5 text-[11px] text-ink-3">
                Showing 12 of {data.rows.length} ·{' '}
                <Link href="/bd" className="text-brand hover:underline">
                  open full BD board
                </Link>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Admin-only firm-overhead expense report. Surfaces every Bill +
 * Expense tagged to one of the three firm-overhead buckets (FHB / FHO /
 * FHX) as a single vendor / amount table. Partners + managers don't see
 * this — they're not responsible for routing firm-overhead spend.
 */
function AdminExpenseReportSection({ data }: { data: AdminExpenseReport }) {
  const BUCKET_LABEL: Record<string, string> = {
    FHB000: 'BD',
    FHO000: 'Operations',
    FHX000: 'Other',
  };
  const BUCKET_VARIANT: Record<string, 'amber' | 'green' | 'blue' | 'outline'> = {
    FHB000: 'blue',
    FHO000: 'green',
    FHX000: 'amber',
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Firm overhead expense report</CardTitle>
          <p className="mt-1 text-xs text-ink-3">
            Bills + expenses tagged to FHB / FHO / FHX. No progress, margin or AR
            — just where the firm-level spend is going.
          </p>
        </div>
        <div className="text-right text-xs">
          <div className="font-mono tabular-nums text-ink">
            {formatMoney(data.totals.grand)}
          </div>
          <div className="text-ink-3">
            {data.totals.rowCount}{' '}
            {data.totals.rowCount === 1 ? 'line' : 'lines'} · live
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-xs">
          {(['FHB000', 'FHO000', 'FHX000'] as const).map((code) => (
            <div
              key={code}
              className="rounded-md border border-line bg-surface-subtle/40 px-3 py-2"
            >
              <div className="text-[10px] uppercase tracking-wide text-ink-3">
                <span className="font-mono">{code}</span> · {BUCKET_LABEL[code]}
              </div>
              <div className="mt-1 font-mono tabular-nums text-ink">
                {formatMoney(data.totals.perBucket[code])}
              </div>
            </div>
          ))}
        </div>
        {data.rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-line bg-surface-subtle/40 px-3 py-4 text-center text-xs text-ink-3">
            No firm-overhead spend yet this period.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle/60 text-[11px] uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Vendor</th>
                  <th className="px-3 py-1.5 text-left font-medium">Bucket</th>
                  <th className="px-3 py-1.5 text-left font-medium">Category</th>
                  <th className="px-3 py-1.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-1.5 text-left font-medium">Status</th>
                  <th className="px-3 py-1.5 text-left font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, 25).map((r) => {
                  const href =
                    r.source === 'bill' ? `/bills/${r.id}` : `/expenses/${r.id}`;
                  return (
                    <tr key={`${r.source}-${r.id}`} className="border-t border-line">
                      <td className="px-3 py-1.5 text-ink">
                        <Link href={href} className="hover:underline">
                          {r.vendor}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge variant={BUCKET_VARIANT[r.bucket] ?? 'outline'}>
                          {BUCKET_LABEL[r.bucket] ?? r.bucket}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5 text-ink-2">
                        <span className="capitalize">
                          {r.category.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">
                        {formatMoney(r.amountCents)}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-ink-3 capitalize">
                        {r.status.replace(/_/g, ' ')}
                      </td>
                      <td className="px-3 py-1.5 text-xs tabular-nums text-ink-3">
                        {r.date.toLocaleDateString('en-AU')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.rows.length > 25 && (
              <div className="border-t border-line bg-surface-subtle/40 px-3 py-1.5 text-[11px] text-ink-3">
                Showing 25 of {data.rows.length} lines · open Bills / Expenses
                for the full register.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FirmOverviewCard({
  firm,
}: {
  firm: ManagerDashboard['firmOverview'];
}) {
  if (firm.total === 0) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Firm overview</CardTitle>
        <Link
          href="/?scope=all"
          className="text-[11px] text-brand hover:underline"
        >
          all projects
        </Link>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Bar label="Projects in delivery" value={firm.inDelivery} max={firm.total} tone="green" />
        <Bar label="On-track %" value={firm.onTrackCount} max={firm.total} tone="green" />
        <Bar label="At-risk (amber)" value={firm.atRiskCount} max={firm.total} tone="amber" />
        <Bar label="Off-track (red)" value={firm.offTrackCount} max={firm.total} tone="red" />
        <div className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
          <span className="text-ink-3">Avg expense ratio</span>
          <span className="text-right tabular-nums text-ink">
            {firm.avgExpenseRatioPct === null ? '—' : `${firm.avgExpenseRatioPct}%`}
          </span>
          <span className="text-ink-3">Avg margin</span>
          <span className="text-right tabular-nums text-ink">
            {firm.avgMarginPct === null ? '—' : `${firm.avgMarginPct}%`}
          </span>
          <span className="text-ink-3">Firm utilisation</span>
          <span className="text-right tabular-nums text-ink">
            {firm.firmUtilisationPct === null ? '—' : `${firm.firmUtilisationPct}%`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Bar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'green' | 'amber' | 'red';
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const color =
    tone === 'green' ? 'bg-status-green' : tone === 'amber' ? 'bg-status-amber' : 'bg-status-red';
  return (
    <div className="grid grid-cols-[1fr_60px] items-center gap-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-ink-3">{label}</span>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-subtle">
          <div className={`absolute left-0 top-0 h-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="text-right tabular-nums text-ink-2">
        {value}/{max}
      </span>
    </div>
  );
}

function ThisWeekCard({ projects }: { projects: ProjectQcCard[] }) {
  // Synthetic agenda — surface the next "things to do" derived from project
  // state. Real calendar comes later via M365.
  const items: Array<{ day: string; label: string; time: string }> = [];
  const wrapping = projects.find((p) => p.stage === 'closing');
  if (wrapping) {
    items.push({
      day: 'Wed',
      label: `${wrapping.code} final QC`,
      time: '—',
    });
  }
  for (const p of projects.slice(0, 3)) {
    items.push({ day: 'Mon', label: `${p.code} team standup`, time: '09:00' });
  }
  const billable = projects.find((p) => p.arOutstandingCents > 0);
  if (billable) {
    items.push({
      day: 'Thu',
      label: `Invoice send · ${billable.code}`,
      time: '—',
    });
  }
  items.push({ day: 'Fri', label: 'Timesheet lock', time: '17:00' });

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>This week</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {items.slice(0, 6).map((it, i) => (
          <div key={i} className="grid grid-cols-[40px_1fr_50px] gap-2">
            <span className="text-ink-3">{it.day}</span>
            <span className="text-ink truncate">{it.label}</span>
            <span className="text-right tabular-nums text-ink-3">{it.time}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AlertsCard({ alerts }: { alerts: ManagerDashboard['alerts'] }) {
  if (alerts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-2 text-xs text-ink-3">Nothing pressing right now.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.map((a) => (
          <div
            key={a.id}
            className={`rounded-md border px-3 py-2 text-xs ${
              a.severity === 'red'
                ? 'border-status-red bg-status-red-soft text-status-red'
                : 'border-status-amber bg-status-amber-soft text-status-amber'
            }`}
          >
            <div className="font-medium text-ink">{a.title}</div>
            {a.body && <div className="mt-0.5 text-[11px]">{a.body}</div>}
            {a.cta && (
              <Link
                href={a.cta.href}
                className="mt-1 inline-block text-[11px] underline-offset-2 hover:underline"
              >
                {a.cta.label} →
              </Link>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Budget watch (consolidated from /budget-watch on 2026-05-07) ────
//
// Surfaces flagged active projects (over budget / near budget / margin
// squeeze) with a compact summary strip. Replaces the standalone page
// so partners get the same signal alongside QC + team week without a
// separate nav stop.

const BUDGET_FLAG_LABEL: Record<BudgetWatchRow['flag'], string> = {
  over_budget: 'Over budget',
  near_budget: 'Near budget',
  margin_squeeze: 'Margin squeeze',
  healthy: 'Healthy',
};
const BUDGET_FLAG_VARIANT: Record<
  BudgetWatchRow['flag'],
  'outline' | 'amber' | 'red'
> = {
  over_budget: 'red',
  near_budget: 'amber',
  margin_squeeze: 'amber',
  healthy: 'outline',
};

function BudgetWatchSection({ data }: { data: BudgetWatch }) {
  const allHealthy = data.flagged.length === 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-end justify-between gap-2">
        <div>
          <CardTitle>Budget watch</CardTitle>
          <p className="text-xs text-ink-3">
            Active projects at risk of eating into margin. Cost reuses
            firm P&amp;L (timesheet × rate + expenses + project-coded bills).
          </p>
        </div>
        <div className="hidden gap-2 md:flex">
          <BudgetSummaryChip
            label="Active"
            value={data.totalActiveProjects}
          />
          <BudgetSummaryChip
            label="Over"
            value={data.summary.overBudget}
            tone={data.summary.overBudget > 0 ? 'red' : 'neutral'}
          />
          <BudgetSummaryChip
            label="Near"
            value={data.summary.nearBudget}
            tone={data.summary.nearBudget > 0 ? 'amber' : 'neutral'}
          />
          <BudgetSummaryChip
            label="Squeeze"
            value={data.summary.marginSqueeze}
            tone={data.summary.marginSqueeze > 0 ? 'amber' : 'neutral'}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {allHealthy ? (
          <p className="px-6 py-6 text-center text-sm text-ink-3">
            Every active project is in good shape. Cost is below 80% of
            contract and realised margin is ≥ 20% on everything with activity.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
                <tr className="border-y border-line">
                  <th className="px-4 py-2 text-left">Flag</th>
                  <th className="px-4 py-2 text-left">Project</th>
                  <th className="px-4 py-2 text-right">Contract</th>
                  <th className="px-4 py-2 text-right">Cost / Contract</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                  <th className="px-4 py-2 text-left">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.flagged.map((p) => (
                  <tr
                    key={p.projectId}
                    className="border-b border-line last:border-b-0"
                  >
                    <td className="px-4 py-2">
                      <Badge
                        variant={BUDGET_FLAG_VARIANT[p.flag]}
                        className="capitalize"
                      >
                        {BUDGET_FLAG_LABEL[p.flag]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/projects/${p.code}`}
                        className="flex items-center gap-1.5 hover:underline"
                      >
                        <span className="font-mono text-xs text-ink-3">
                          {p.code}
                        </span>
                        <span className="text-ink">{p.name}</span>
                        <span className="font-mono text-[10px] text-ink-4">
                          · {p.clientCode}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-3">
                      {formatMoney(p.contractValueCents)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span
                        className={`font-semibold ${
                          p.costOfContractPct !== null &&
                          p.costOfContractPct >= 100
                            ? 'text-status-red'
                            : p.costOfContractPct !== null &&
                                p.costOfContractPct >= 80
                              ? 'text-status-amber'
                              : 'text-ink'
                        }`}
                      >
                        {p.costOfContractPct === null
                          ? '—'
                          : `${p.costOfContractPct.toFixed(0)}%`}
                      </span>
                      <span className="ml-1 text-xs text-ink-3">
                        ({formatMoney(p.costCents)})
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
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
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-3">
                      {p.flagReason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetSummaryChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'amber' | 'red';
}) {
  const cls =
    tone === 'red'
      ? 'border-status-red text-status-red'
      : tone === 'amber'
        ? 'border-status-amber text-status-amber'
        : 'border-line text-ink-2';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] ${cls}`}
    >
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-ink-3">{label}</span>
    </span>
  );
}
