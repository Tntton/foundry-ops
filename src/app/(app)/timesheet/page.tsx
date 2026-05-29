import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { hasAnyRole } from '@/server/roles';
import {
  getMonthForPerson,
  getWeekForPerson,
  listPersonTimesheetEntries,
  getHourlyUtilisationForWeek,
  getApprovalHistoryForPerson,
} from '@/server/timesheet';
import { prisma } from '@/server/db';
import {
  addDays,
  formatIsoDate,
  fourWeekDates,
  parseIsoDate,
  startOfFourWeekBlock,
  startOfWeek,
  weekDates as weekDatesFn,
} from '@/lib/week';
import { PersonAvatar } from '@/components/person-avatar';
import { Button } from '@/components/ui/button';
import { TimesheetGrid } from './grid';
import { TimesheetPersonPicker } from './person-picker';
import { TimesheetSubmittedOverview } from './submitted-overview';

// Availability forecasting moved to its own surface at /availability —
// keep this page focused on the day-to-day "log my hours" workflow.

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: { week?: string; view?: string; personId?: string };
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'timesheet.submit')) notFound();

  const view: 'month' | 'week' = searchParams.view === 'week' ? 'week' : 'month';
  const isSuperAdmin = hasAnyRole(session, ['super_admin']);
  const isAdminGroup = hasAnyRole(session, ['super_admin', 'admin']);
  const isManagerOrLead = hasAnyRole(session, ['manager', 'partner']);
  const canActOnBehalf = isAdminGroup || isManagerOrLead;

  // Super-admin / admin can edit on behalf of anyone. Managers + lead
  // partners can edit on behalf of people on projects they lead — the save
  // action enforces the per-project gate, but we also filter the picker so
  // they only see candidates they can actually save for.
  let target = session.person;
  let actingOnBehalf = false;
  if (searchParams.personId && searchParams.personId !== session.person.id) {
    if (!canActOnBehalf) notFound();
    const fetched = await prisma.person.findUnique({
      where: { id: searchParams.personId },
      select: {
        id: true,
        initials: true,
        headshotUrl: true,
        firstName: true,
        lastName: true,
        endDate: true,
        roles: true,
        email: true,
        band: true,
      },
    });
    if (!fetched) notFound();
    target = {
      id: fetched.id,
      initials: fetched.initials,
      firstName: fetched.firstName,
      lastName: fetched.lastName,
      email: fetched.email,
      roles: fetched.roles,
      headshotUrl: fetched.headshotUrl,
      band: fetched.band,
    };
    actingOnBehalf = true;
  }

  // Picker options:
  //   - admin / super_admin → every active person
  //   - manager / partner → people on the projects they lead (so the on-behalf
  //     auto-approve gate has someone to land on)
  let teamOptions: Array<{
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
  }> = [];
  if (canActOnBehalf) {
    if (isAdminGroup) {
      teamOptions = await prisma.person.findMany({
        // Exclude Support_Staff — they're off the consulting pyramid
        // and have no project assignments to log against. They CAN
        // log time for themselves via /timesheet (Jas e.g. still bills
        // her hours) but admins shouldn't pick them in the on-behalf
        // dropdown.
        where: { endDate: null, band: { not: 'Support_Staff' } },
        orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
        select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
      });
    } else {
      // Manager / partner: pull active people who sit on a project this user
      // leads. The de-duped union also includes the project leadership rows
      // (they may want to pick co-leads).
      const ledProjects = await prisma.project.findMany({
        where: {
          stage: { not: 'archived' },
          OR: [
            { managerId: session.person.id },
            { primaryPartnerId: session.person.id },
          ],
        },
        select: {
          managerId: true,
          primaryPartnerId: true,
          team: { select: { personId: true } },
        },
      });
      const candidateIds = new Set<string>();
      for (const p of ledProjects) {
        candidateIds.add(p.managerId);
        candidateIds.add(p.primaryPartnerId);
        for (const t of p.team) candidateIds.add(t.personId);
      }
      candidateIds.delete(session.person.id);
      teamOptions = candidateIds.size
        ? await prisma.person.findMany({
            where: {
              id: { in: [...candidateIds] },
              endDate: null,
            },
            orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
            select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
          })
        : [];
    }
  }

  const anchor = parseIsoDate(searchParams.week);
  const blockStart = view === 'month' ? startOfFourWeekBlock(anchor) : startOfWeek(anchor);
  const cells = view === 'month' ? fourWeekDates(blockStart) : weekDatesFn(blockStart);
  const rangeEnd = addDays(blockStart, cells.length - 1);

  const prevDelta = view === 'month' ? -28 : -7;
  const nextDelta = view === 'month' ? 28 : 7;
  const prev = formatIsoDate(addDays(blockStart, prevDelta));
  const next = formatIsoDate(addDays(blockStart, nextDelta));

  function buildLink(params: Record<string, string | undefined>): string {
    const merged: Record<string, string | undefined> = {
      view,
      ...params,
    };
    if (actingOnBehalf) merged['personId'] = target.id;
    const qs = Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join('&');
    return `/timesheet${qs ? `?${qs}` : ''}`;
  }

  const rows =
    view === 'month'
      ? await getMonthForPerson(target.id, blockStart)
      : await getWeekForPerson(target.id, blockStart);

  // Pull a 6-month window of submitted/approved/billed entries so the
  // overview below the grid shows the running record of decisions, not just
  // what fits in the current 4-week block.
  const overviewFrom = new Date();
  overviewFrom.setUTCDate(overviewFrom.getUTCDate() - 26 * 7);

  const [allProjects, teamMemberships, submittedHistory, targetPerson] =
    await Promise.all([
      prisma.project.findMany({
        where: { stage: { not: 'archived' } },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, stage: true },
      }),
      prisma.projectTeam.findMany({
        where: { personId: target.id },
        select: { projectId: true },
      }),
      listPersonTimesheetEntries(target.id, { from: overviewFrom }),
      prisma.person.findUnique({
        where: { id: target.id },
        select: { rate: true, rateUnit: true, inactiveAt: true },
      }),
    ]);
  const teamProjectIds = new Set(teamMemberships.map((t) => t.projectId));
  // Hourly rate in cents — Person.rate is per `rateUnit` (hour or day). Day rate / 8 ≈ hourly.
  const hourlyRateCents = targetPerson
    ? targetPerson.rateUnit === 'day'
      ? Math.round((targetPerson.rate ?? 0) / 8)
      : (targetPerson.rate ?? 0)
    : 0;
  const isInactive = targetPerson?.inactiveAt !== null && targetPerson?.inactiveAt !== undefined;

  const currentWeekStart = startOfWeek(new Date());
  const [hourlyUtilisation, approvalHistory] = await Promise.all([
    getHourlyUtilisationForWeek(target.id, currentWeekStart),
    getApprovalHistoryForPerson(target.id, 4),
  ]);

  const canApprove = hasAnyRole(session, ['super_admin', 'admin', 'manager']);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-ink">
          <span>🕒</span>
          <span className="font-semibold">
            {view === 'week' ? 'Log hours · this week' : 'Log hours · 4-week view'}
          </span>
        </div>
        <Link
          href={
            actingOnBehalf
              ? `/availability?personId=${target.id}`
              : '/availability'
          }
          className="text-xs text-brand hover:underline"
        >
          Open availability forecast →
        </Link>
      </div>

      {actingOnBehalf && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Editing on behalf of{' '}
          <span className="font-medium">
            {target.firstName} {target.lastName}
          </span>
          . Saves are written to their sheet and audited under your name. Switch back to{' '}
          <Link href="/timesheet" className="underline">
            your own timesheet
          </Link>
          .
        </div>
      )}

      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {actingOnBehalf && (
            <PersonAvatar
  className="h-9 w-9"
  fallbackClassName="text-xs"
  initials={target.initials}
  headshotUrl={target.headshotUrl}
/>
          )}
          <div>
            <h1 className="text-xl font-semibold text-ink">
              {actingOnBehalf
                ? `${target.firstName} ${target.lastName}'s timesheet`
                : 'Timesheet'}
            </h1>
            <p className="text-sm text-ink-3">
              {view === 'month' ? 'Rolling 4-week block · ' : 'Week of '}
              {blockStart.toLocaleDateString('en-AU')} – {rangeEnd.toLocaleDateString('en-AU')}.
              Submitted entries stay visible. Logging time on a new project auto-adds the
              person to the project team for resourcing.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canActOnBehalf && teamOptions.length > 0 && (
            <TimesheetPersonPicker
              view={view}
              selfId={session.person.id}
              selfFirstName={session.person.firstName}
              selfLastName={session.person.lastName}
              selectedPersonId={target.id}
              options={teamOptions}
            />
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={buildLink({ week: prev })}>← Previous</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={buildLink({})}>Now</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={buildLink({ week: next })}>Next →</Link>
          </Button>
          <div className="ml-2 flex overflow-hidden rounded-md border border-line text-xs">
            <Link
              href={buildLink({ view: 'week' }).replace(`view=${view}`, 'view=week')}
              className={`px-2 py-1 font-medium ${view === 'week' ? 'bg-brand text-white' : 'text-ink-3 hover:bg-surface-hover'}`}
            >
              Week
            </Link>
            <Link
              href={buildLink({ view: 'month' }).replace(`view=${view}`, 'view=month')}
              className={`px-2 py-1 font-medium ${view === 'month' ? 'bg-brand text-white' : 'text-ink-3 hover:bg-surface-hover'}`}
            >
              Month
            </Link>
          </div>
          {canApprove && !actingOnBehalf && (
            <Button asChild variant="outline" size="sm">
              <Link href="/timesheet/approve">Approve queue</Link>
            </Button>
          )}
        </div>
      </header>

      {isInactive ? (
        <div className="rounded-lg border border-status-amber bg-status-amber-soft/40 px-4 py-3 text-sm text-status-amber">
          <strong>
            {actingOnBehalf
              ? `${target.firstName}'s profile is inactive`
              : 'Your profile is inactive'}
          </strong>
          <span className="ml-1 text-ink-2">
            — timesheet inputs are disabled until the profile is
            reactivated.{' '}
            <Link
              href={`/directory/people/${target.id}`}
              className="underline hover:text-status-amber"
            >
              Open profile →
            </Link>
          </span>
        </div>
      ) : allProjects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card p-10 text-center">
          <h2 className="text-sm font-medium text-ink">No active projects yet</h2>
          <p className="mt-2 text-sm text-ink-3">
            There&apos;s nothing to log time against. Ask a partner or admin to create a project
            first.
          </p>
          {hasAnyRole(session, ['super_admin', 'admin', 'partner']) && (
            <Button asChild size="sm" className="mt-4">
              <Link href="/projects/new">Create project</Link>
            </Button>
          )}
        </div>
      ) : (
        <TimesheetGrid
          rangeStart={formatIsoDate(blockStart)}
          initialRows={rows}
          cells={cells}
          allProjects={allProjects.map((p) => ({
            ...p,
            isTeamMember: teamProjectIds.has(p.id),
          }))}
          view={view}
          targetPersonId={target.id}
          actingOnBehalf={actingOnBehalf}
          isSuperAdmin={isSuperAdmin}
          hourlyRateCents={hourlyRateCents}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <UtilisationCard hours={hourlyUtilisation} />
        <QuickAddCard targetPersonId={target.id} view={view} />
        <ApprovalHistoryCard history={approvalHistory} />
      </div>

      <TimesheetSubmittedOverview
        entries={submittedHistory}
        csvHref={`/api/reports/timesheet?personId=${target.id}`}
      />
    </div>
  );
}

function UtilisationCard({
  hours,
}: {
  hours: NonNullable<Awaited<ReturnType<typeof getHourlyUtilisationForWeek>>>;
}) {
  const max = Math.max(1, ...hours.byCategory.map((c) => c.hours));
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
        Your hours · this week
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-ink">
          {hours.totalHours.toFixed(1)}h
        </span>
        <span className="text-xs text-ink-3">across {hours.byProject.length} project{hours.byProject.length === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-3 space-y-2">
        {hours.byCategory.length === 0 ? (
          <p className="text-xs text-ink-3">Nothing logged yet this week.</p>
        ) : (
          hours.byCategory.map((c) => (
            <div key={c.category} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink-2">{c.label}</span>
                <span className="tabular-nums text-ink">{c.hours.toFixed(1)}h</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
                <div
                  className={
                    c.category === 'delivery'
                      ? 'h-full bg-status-green'
                      : c.category === 'kickoff'
                        ? 'h-full bg-status-amber'
                        : c.category === 'closing'
                          ? 'h-full bg-status-blue'
                          : 'h-full bg-ink-3'
                  }
                  style={{ width: `${Math.round((c.hours / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function QuickAddCard({
  targetPersonId,
  view,
}: {
  targetPersonId: string;
  view: 'week' | 'month';
}) {
  // Single-line natural-language quick-add — the inline parser
  // (parseQuickAddInput in @/server/timesheet) reads `project · day
  // · hours`, optionally prefixed with a `bd` modifier. The card
  // copy USED to claim "Quick-add via ⌘K" but the global palette
  // doesn't intercept this input today — that was a misleading
  // affordance. Renamed to "Quick-add" + retitled the hint to
  // "Tab to fill" so the user understands it's an in-form input,
  // not a launcher trigger.
  return (
    <form
      action="/timesheet"
      method="get"
      className="rounded-lg border border-line bg-card p-4"
    >
      <input type="hidden" name="personId" value={targetPersonId} />
      <input type="hidden" name="view" value={view} />
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
          Quick-add
        </div>
        <div className="text-[10px] text-ink-4">type · enter to submit</div>
      </div>
      <input
        name="q"
        placeholder="e.g. IFM001 thu 8"
        className="mt-2 w-full rounded-md border border-line bg-surface-subtle px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
      />
      <div className="mt-2 space-y-1.5 text-[11px] text-ink-3">
        <div className="flex items-center gap-1">
          <span>→</span>
          <span>
            <span className="font-mono text-ink-2">IFM001 thu 8</span> · project
            · day · hours
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span>→</span>
          <span>
            <span className="font-mono text-ink-2">bd pnc002 tue 2h</span> · BD
            modifier optional
          </span>
        </div>
      </div>
    </form>
  );
}

function ApprovalHistoryCard({
  history,
}: {
  history: NonNullable<Awaited<ReturnType<typeof getApprovalHistoryForPerson>>>;
}) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
        Approval history
      </div>
      <ul className="mt-2 divide-y divide-line">
        {history.map((r, i) => {
          const weekNum = isoWeekNumber(r.weekStart);
          const ws = r.weekStart;
          const we = new Date(ws.getTime() + 6 * 86_400_000);
          const range = `${ws.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}–${we.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;
          const tone =
            r.status === 'approved'
              ? 'green'
              : r.status === 'submitted' || r.status === 'mixed'
                ? 'amber'
                : r.status === 'billed'
                  ? 'blue'
                  : 'outline';
          return (
            <li
              key={i}
              className="flex items-center justify-between py-2 text-xs"
            >
              <div>
                <span className="text-ink">Wk {weekNum}</span>{' '}
                <span className="text-ink-3">
                  · {r.isCurrentWeek ? 'this week' : range}
                </span>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                  tone === 'green'
                    ? 'bg-status-green-soft text-status-green'
                    : tone === 'amber'
                      ? 'bg-status-amber-soft text-status-amber'
                      : tone === 'blue'
                        ? 'bg-status-blue-soft text-status-blue'
                        : 'border border-line text-ink-3'
                }`}
              >
                <span className="inline-block h-1 w-1 rounded-full bg-current" />
                {r.status === 'approved' && r.approverInitials
                  ? `approved · ${r.approverInitials}`
                  : r.status}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function isoWeekNumber(d: Date): number {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

// AvailabilityForecast view + editor live at /availability now — see
// the schedule-table.tsx + availability-editor.tsx components in that
// route. Removed from this file when the surface was split out.
