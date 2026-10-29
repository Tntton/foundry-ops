import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { TimesheetPeriodState } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { hasAnyRole } from '@/server/roles';
import {
  findTimesheetPeriod,
  getMonthForPerson,
  getPeriodTotals,
  getWeekForPerson,
  listPersonTimesheetEntries,
  getHourlyUtilisationForWeek,
  getApprovalHistoryForPerson,
  getQuarterSummaryForPerson,
  getPeriodLocksForRange,
  periodLockFor,
} from '@/server/timesheet';
import { prisma } from '@/server/db';
import {
  addDays,
  addQuarters,
  formatIsoDate,
  addMonths,
  formatMonthLabel,
  formatQuarterLabel,
  monthDates,
  monthNumber,
  parseIsoDate,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  weekDates as weekDatesFn,
  todayInFirmTz,
} from '@/lib/week';
import { PersonAvatar } from '@/components/person-avatar';
import { PrefillBanner } from '@/components/prefill-banner';
import { Button } from '@/components/ui/button';
import { TimesheetGrid } from './grid';
import { TimesheetPersonPicker } from './person-picker';
import { TimesheetSubmittedOverview } from './submitted-overview';
import { LodgeMonthButton } from './lodge-month-button';
import { TimesheetQuarterView } from './quarter-summary';
import { verifyPrefillToken } from '@/server/agents/assistant/prefill/token';
import { TimesheetPrefillSchema } from '@/server/agents/assistant/prefill/schemas';
import { applyTimesheetPrefill } from '@/server/agents/assistant/prefill/apply-timesheet';
import { writeAudit } from '@/server/audit';

// Availability forecasting moved to its own surface at /availability —
// keep this page focused on the day-to-day "log my hours" workflow.

/**
 * Week and month are editable day grids. Quarter is a read-only roll-up —
 * 90-odd editable columns is not a grid anyone can use, and a quarter is
 * what someone opens to check history, not to type into.
 */
export type TimesheetView = 'week' | 'month' | 'quarter';

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: { week?: string; view?: string; personId?: string; prefill?: string };
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'timesheet.submit')) notFound();

  // Week view is the default — staff log weekly, and the 28-column
  // month grid forced a toggle-click (or a long horizontal scroll)
  // on every visit. Month and quarter stay one click away for reviewers.
  //
  // Quarter is a read-only roll-up (projects × the quarter's three months),
  // not a 90-column grid: checking back over a quarter is a review job, and
  // the month link in each column header is the way into editing.
  const view: TimesheetView =
    searchParams.view === 'month' ? 'month' : searchParams.view === 'quarter' ? 'quarter' : 'week';
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
          OR: [{ managerId: session.person.id }, { primaryPartnerId: session.person.id }],
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
            select: {
              id: true,
              initials: true,
              headshotUrl: true,
              firstName: true,
              lastName: true,
            },
          })
        : [];
    }
  }

  const anchor = parseIsoDate(searchParams.week);
  // Month view is a REAL calendar month (28–31 days), not the old rolling
  // 28-day block — a lodgement period has to be nameable ("August") or a
  // contractor can't invoice for it (TASK-501). Quarter follows the calendar
  // quarters, whose boundaries are also the AU FY quarters (the FY only
  // changes where the count starts), so one range serves both readings.
  const blockStart =
    view === 'quarter'
      ? startOfQuarter(anchor)
      : view === 'month'
        ? startOfMonth(anchor)
        : startOfWeek(anchor);
  // Day cells only exist for the editable views. Quarter renders month
  // columns instead, so it has no day grid and no `cells`.
  const cells =
    view === 'quarter' ? [] : view === 'month' ? monthDates(blockStart) : weekDatesFn(blockStart);
  const rangeEnd =
    view === 'quarter'
      ? addDays(addQuarters(blockStart, 1), -1)
      : addDays(blockStart, cells.length - 1);

  // Step by whole months / quarters so the picker lands on the 1st every
  // time; a fixed ±28d would drift off the calendar within two hops.
  const prev = formatIsoDate(
    view === 'quarter'
      ? addQuarters(blockStart, -1)
      : view === 'month'
        ? addMonths(blockStart, -1)
        : addDays(blockStart, -7),
  );
  const next = formatIsoDate(
    view === 'quarter'
      ? addQuarters(blockStart, 1)
      : view === 'month'
        ? addMonths(blockStart, 1)
        : addDays(blockStart, 7),
  );
  const periodLabel =
    view === 'quarter'
      ? formatQuarterLabel(blockStart)
      : view === 'month'
        ? formatMonthLabel(blockStart)
        : `Week of ${blockStart.toLocaleDateString('en-AU')}`;

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

  // Quarter view never renders the day grid, so don't pay for its rows.
  const rows: Awaited<ReturnType<typeof getWeekForPerson>> =
    view === 'quarter'
      ? []
      : view === 'month'
        ? await getMonthForPerson(target.id, blockStart)
        : await getWeekForPerson(target.id, blockStart);
  const quarterSummary =
    view === 'quarter' ? await getQuarterSummaryForPerson(target.id, blockStart) : null;

  // Month lock per day index, for the rows the BROWSER builds (add-row,
  // copy-last-week, assistant prefill). The rows the server sends already
  // carry it per cell; a row added client-side has no entry to read it from,
  // and without this an invoiced month renders open inputs on its empty days
  // (TASK-523).
  const cellPeriodLocks =
    cells.length === 0
      ? []
      : await (async () => {
          const locks = await getPeriodLocksForRange(
            target.id,
            blockStart,
            addDays(blockStart, cells.length),
          );
          return cells.map((d) => periodLockFor(locks, d));
        })();

  // Previous week's rows feed the "Copy last week" quick action (week
  // view only) — a repeat week becomes two clicks instead of five
  // typed cells. Month view skips it: the 28-day grid already shows
  // history inline.
  const lastWeekRows =
    view === 'week'
      ? // carryForward=false: this lookup wants last week's HOURS for the
        // copy action, not a row list — carrying forward would make it
        // reflect the week before that (TASK-510).
        await getWeekForPerson(target.id, addDays(blockStart, -7), false)
      : null;

  // Pull a 6-month window of submitted/approved/billed entries so the
  // overview below the grid shows the running record of decisions, not just
  // what fits in the current 4-week block.
  const overviewFrom = new Date();
  overviewFrom.setUTCDate(overviewFrom.getUTCDate() - 26 * 7);

  // Firm-overhead expense buckets (FHB000 / FHO000 / FHX000) are for OPEX
  // bills, not timesheet time — keep them out of the picker (matches the
  // hiding in server/projects.ts). Internal FHP projects stay: FHP000 is
  // the home for non-project / admin time (feedback #12), later
  // reallocated to a real project by editing the draft entry.
  const OPEX_BUCKET_CODES = ['FHB000', 'FHO000', 'FHX000'];
  // Active projects (everything not archived) are visible to anyone via
  // the picker. ALL closed/archived projects are also offered now —
  // grouped separately and flagged "needs approval" — so late/correcting
  // hours can be booked to any finished engagement (Matt Byers,
  // feedback #12), not just ones the person already had a footprint on.
  // saveTimesheet still excludes archived-project entries from
  // auto-approve, so they route through normal approval.
  const [activeProjects, teamMemberships, submittedHistory, targetPerson, archivedProjects] =
    await Promise.all([
      prisma.project.findMany({
        where: {
          stage: { not: 'archived' },
          code: { notIn: OPEX_BUCKET_CODES },
        },
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
        select: { rate: true, rateUnit: true, inactiveAt: true, employment: true },
      }),
      prisma.project.findMany({
        where: { stage: 'archived', code: { notIn: OPEX_BUCKET_CODES } },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, stage: true },
      }),
    ]);
  const allProjects = [...activeProjects, ...archivedProjects];
  const teamProjectIds = new Set(teamMemberships.map((t) => t.projectId));
  // Hourly rate in cents — Person.rate is per `rateUnit` (hour or day). Day rate / 8 ≈ hourly.
  const hourlyRateCents = targetPerson
    ? targetPerson.rateUnit === 'day'
      ? Math.round((targetPerson.rate ?? 0) / 8)
      : (targetPerson.rate ?? 0)
    : 0;
  const isInactive = targetPerson?.inactiveAt !== null && targetPerson?.inactiveAt !== undefined;
  // Contractors invoice Foundry for their approved hours; full-time staff are
  // paid through the monthly pay run and never invoice. The CTA below is the
  // only in-context pointer to that flow, so it must not appear for someone
  // on payroll — an invoice button on an employee's timesheet is a support
  // ticket, not a feature.
  const isContractor = targetPerson?.employment === 'contractor';

  // ─── Assistant prefill (TASK-302a) ──────────────────────────────────
  // The assistant signs a one-time token containing rows to populate.
  // Decode + verify here on the server; merge into `rows` BEFORE
  // passing to the client grid so the user lands on a fully-formed
  // sheet. Failures are silent (the page still renders normally) +
  // surface a small notice via prefillNotice.
  let prefillSummary: string | null = null;
  let prefillIgnored:
    | ReadonlyArray<{ projectCode: string; dateIso: string; reason: string }>
    | undefined;
  let prefillNotice: string | null = null;
  let enrichedRows = rows;
  if (searchParams.prefill && target.id === session.person.id && view !== 'quarter') {
    const verify = verifyPrefillToken(searchParams.prefill, {
      personId: session.person.id,
      kind: 'timesheet',
    });
    if (verify.ok) {
      const payloadCheck = TimesheetPrefillSchema.safeParse(verify.payload.payload);
      if (payloadCheck.success) {
        const result = applyTimesheetPrefill(
          rows,
          payloadCheck.data,
          cells,
          allProjects,
          cellPeriodLocks,
        );
        enrichedRows = result.rows;
        prefillIgnored = result.ignored.length > 0 ? result.ignored : undefined;
        const appliedSummary = result.applied
          .map((a) => `${a.hours}h on ${a.projectCode} ${a.dateIso}`)
          .join('; ');
        prefillSummary =
          result.applied.length > 0
            ? appliedSummary
            : 'Nothing to populate — the prefill rows fell outside this week or referenced unknown projects.';
        // Audit the redemption so we can pair it with the mint event
        // and see end-to-end usage.
        try {
          await prisma.$transaction(async (tx) => {
            await writeAudit(tx, {
              actor: { type: 'person', id: session.person.id },
              action: 'redeemed',
              entity: {
                type: 'assistant_prefill',
                id: `${session.person.id}:${formatIsoDate(blockStart)}`,
                after: {
                  kind: 'timesheet',
                  applied: result.applied,
                  ignored: result.ignored,
                  jti: verify.payload.jti,
                },
              },
              source: 'agent',
            });
          });
        } catch (err) {
          console.error('[timesheet.prefill] audit redeem failed:', err);
        }
      } else {
        prefillNotice = 'Prefill payload malformed — opened the form without changes.';
      }
    } else if (verify.reason === 'expired') {
      prefillNotice = 'Prefill link expired (15-min TTL). Ask the assistant for a fresh one.';
    } else if (verify.reason === 'wrong_person') {
      prefillNotice = "That prefill link wasn't minted for your account.";
    } else {
      prefillNotice = 'Prefill link invalid — opened the form without changes.';
    }
  }

  // URL the banner's "Undo" navigates to — same view + week, no prefill.
  const cleanUrl = (() => {
    const params = new URLSearchParams();
    if (view === 'week') params.set('view', 'week');
    if (searchParams.week) params.set('week', searchParams.week);
    if (actingOnBehalf) params.set('personId', target.id);
    const qs = params.toString();
    return `/timesheet${qs ? `?${qs}` : ''}`;
  })();

  const currentWeekStart = startOfWeek(todayInFirmTz());
  // Latest approve / send-back decision on this person's hours, so the
  // outcome (and the approver's reason on a send-back) lands on the
  // timesheet itself rather than only in the updates feed. 14-day window
  // keeps a stale decision from sitting at the top of the page forever.
  const decisionSince = addDays(todayInFirmTz(), -14);
  const [hourlyUtilisation, approvalHistory, latestDecision] = await Promise.all([
    getHourlyUtilisationForWeek(target.id, currentWeekStart),
    getApprovalHistoryForPerson(target.id, 4),
    prisma.userUpdate.findFirst({
      where: {
        personId: target.id,
        kind: { in: ['timesheet_approved', 'timesheet_rejected'] },
        createdAt: { gte: decisionSince },
      },
      orderBy: { createdAt: 'desc' },
      select: { kind: true, title: true, body: true, createdAt: true, readAt: true },
    }),
  ]);

  const canApprove = hasAnyRole(session, ['super_admin', 'admin', 'manager']);

  // Lodgement state for the month on screen. Read-only here — the row is
  // created by the lodge action, not by looking at the grid, so browsing an
  // admin through twelve months of someone's history doesn't litter the table
  // with twelve `open` rows. A month with no row IS open, which is what the
  // null branch renders.
  const period = view === 'month' ? await findTimesheetPeriod(target.id, blockStart) : null;
  const periodState = period?.state ?? 'open';
  // Totals for the lodge card. Cheap aggregate over the month already on
  // screen — the grid rows can't be reused because they're padded out to
  // every project the person is rostered on, worked or not.
  const periodTotals = view === 'month' ? await getPeriodTotals(target.id, blockStart) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-ink">
          <span>🕒</span>
          <span className="font-semibold">
            {view === 'week'
              ? 'Log hours · this week'
              : view === 'quarter'
                ? `Review hours · ${periodLabel}`
                : `Log hours · ${periodLabel}`}
          </span>
          {view === 'month' && <PeriodStateChip state={periodState} />}
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={actingOnBehalf ? `/availability?personId=${target.id}` : '/availability'}
            className="text-xs text-brand hover:underline"
          >
            Open availability forecast →
          </Link>
          {isContractor && (
            <Button asChild size="sm">
              <Link href={actingOnBehalf ? `/me/invoices?personId=${target.id}` : '/me/invoices'}>
                Generate invoice →
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* TASK-510. The timesheet is where a contractor already is when they
          think about getting paid, so the route to invoicing belongs here
          rather than only in the avatar menu. Stating the gate on the card
          ("approved hours") teaches the rule up front — the alternative is a
          bare link and a contractor discovering the rule by arriving at an
          empty invoice. */}
      {isContractor && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3">
          <div className="text-sm">
            <p className="font-medium text-ink">Ready to invoice Foundry?</p>
            <p className="text-ink-3">
              Pick a date range and raise your invoice from your approved hours. Time still waiting
              on a project lead is listed too, so you can see what is holding it up.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={actingOnBehalf ? `/me/invoices?personId=${target.id}` : '/me/invoices'}>
              Generate invoice
            </Link>
          </Button>
        </div>
      )}

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
              {actingOnBehalf ? `${target.firstName} ${target.lastName}'s timesheet` : 'Timesheet'}
            </h1>
            <p className="text-sm text-ink-3">
              {periodLabel}
              {view === 'quarter'
                ? ` · ${blockStart.toLocaleDateString('en-AU')} – ${rangeEnd.toLocaleDateString('en-AU')}.`
                : view === 'month'
                  ? ` · ${blockStart.toLocaleDateString('en-AU')} – ${rangeEnd.toLocaleDateString('en-AU')} · ${cells.length} days.`
                  : ` – ${rangeEnd.toLocaleDateString('en-AU')}.`}{' '}
              {view === 'quarter'
                ? 'Read-only roll-up by month. Open a month to edit anything still in draft.'
                : 'Submitted entries stay visible, and approved days are locked. Logging time on a new project auto-adds the person to the project team for resourcing.'}
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
          {/* Week / Month / Quarter. The `week` param is just an anchor
              date — each view snaps it to its own boundary, so switching
              view keeps you in roughly the same place in time instead of
              jumping back to today. */}
          <div className="ml-2 flex overflow-hidden rounded-md border border-line text-xs">
            {(['week', 'month', 'quarter'] as const).map((v) => (
              <Link
                key={v}
                href={buildLink({ view: v, week: formatIsoDate(blockStart) })}
                aria-current={view === v ? 'page' : undefined}
                className={`px-2 py-1 font-medium capitalize ${
                  view === v ? 'bg-brand text-white' : 'text-ink-3 hover:bg-surface-hover'
                }`}
              >
                {v}
              </Link>
            ))}
          </div>
          {canApprove && !actingOnBehalf && (
            <Button asChild variant="outline" size="sm">
              <Link href="/timesheet/approve">Approve queue</Link>
            </Button>
          )}
        </div>
      </header>

      {view === 'quarter' && quarterSummary ? (
        <>
          {latestDecision && (
            <TimesheetDecisionBanner
              kind={
                latestDecision.kind === 'timesheet_rejected'
                  ? 'timesheet_rejected'
                  : 'timesheet_approved'
              }
              title={latestDecision.title}
              body={latestDecision.body}
              at={latestDecision.createdAt}
              unread={latestDecision.readAt === null}
              isSelf={!actingOnBehalf}
            />
          )}
          <TimesheetQuarterView
            summary={quarterSummary}
            hourlyRateCents={hourlyRateCents}
            monthHref={(monthStart) =>
              buildLink({ view: 'month', week: formatIsoDate(monthStart) })
            }
          />
        </>
      ) : isInactive ? (
        <div className="rounded-lg border border-status-amber bg-status-amber-soft/40 px-4 py-3 text-sm text-status-amber">
          <strong>
            {actingOnBehalf
              ? `${target.firstName}'s profile is inactive`
              : 'Your profile is inactive'}
          </strong>
          <span className="ml-1 text-ink-2">
            — timesheet inputs are disabled until the profile is reactivated.{' '}
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
        <>
          {latestDecision && (
            <TimesheetDecisionBanner
              kind={
                latestDecision.kind === 'timesheet_rejected'
                  ? 'timesheet_rejected'
                  : 'timesheet_approved'
              }
              title={latestDecision.title}
              body={latestDecision.body}
              at={latestDecision.createdAt}
              unread={latestDecision.readAt === null}
              isSelf={!actingOnBehalf}
            />
          )}
          {prefillSummary && (
            <PrefillBanner summary={prefillSummary} cleanUrl={cleanUrl} ignored={prefillIgnored} />
          )}
          {prefillNotice && !prefillSummary && (
            <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-xs text-status-amber">
              {prefillNotice}
            </div>
          )}
          {view === 'month' && periodTotals !== null && (
            <div className="mb-4">
              <LodgeMonthButton
                targetPersonId={target.id}
                year={blockStart.getUTCFullYear()}
                month={monthNumber(blockStart)}
                monthLabel={periodLabel}
                totalHours={periodTotals.totalHours}
                projectCount={periodTotals.projectCount}
                state={periodState}
                disabledReason={
                  periodTotals.totalHours === 0
                    ? `No hours logged in ${periodLabel} yet — add some before lodging.`
                    : null
                }
              />
            </div>
          )}

          <TimesheetGrid
            rangeStart={formatIsoDate(blockStart)}
            initialRows={enrichedRows}
            cells={cells}
            allProjects={allProjects.map((p) => ({
              ...p,
              isTeamMember: teamProjectIds.has(p.id),
            }))}
            // Quarter never reaches the grid (it renders the roll-up
            // above), so the grid keeps its two-view contract.
            view={view === 'month' ? 'month' : 'week'}
            targetPersonId={target.id}
            actingOnBehalf={actingOnBehalf}
            isSuperAdmin={isSuperAdmin}
            hourlyRateCents={hourlyRateCents}
            lastWeekRows={lastWeekRows}
            cellPeriodLocks={cellPeriodLocks}
          />
        </>
      )}

      {/* QuickAddCard removed (QC 2026-07-07): its GET form did a full
          navigation that silently discarded unsaved grid hours, and no
          code ever read the `q` param — a pure data-loss trap. The
          assistant's prefill path covers natural-language entry. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UtilisationCard hours={hourlyUtilisation} />
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
        <span className="text-xs text-ink-3">
          across {hours.byProject.length} project{hours.byProject.length === 1 ? '' : 's'}
        </span>
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

/**
 * Decision flag for the submitter. An approval is a quiet confirmation;
 * a send-back is the one the person has to act on, so it carries the
 * approver's reason inline and reads red rather than green.
 */
function TimesheetDecisionBanner({
  kind,
  title,
  body,
  at,
  unread,
  isSelf,
}: {
  kind: 'timesheet_approved' | 'timesheet_rejected';
  title: string;
  body: string | null;
  at: Date;
  unread: boolean;
  isSelf: boolean;
}) {
  const sentBack = kind === 'timesheet_rejected';
  const when = at.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        sentBack
          ? 'border-status-red bg-status-red-soft text-status-red'
          : 'border-status-green bg-status-green-soft text-status-green'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>{isSelf ? title : title.replace(/^Your timesheet/, 'This timesheet')}</strong>
        <span className="opacity-70">· {when}</span>
        {unread && (
          <span className="rounded-full border border-current px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            new
          </span>
        )}
        <Link href="/updates" className="ml-auto underline">
          All updates →
        </Link>
      </div>
      {body && <div className="mt-1 text-ink-2">{body}</div>}
      {sentBack && (
        <div className="mt-1 text-ink-3">
          These hours are back in draft above — fix them and hit Submit again.
        </div>
      )}
    </div>
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
            <li key={i} className="flex items-center justify-between py-2 text-xs">
              <div>
                <span className="text-ink">Wk {weekNum}</span>{' '}
                <span className="text-ink-3">· {r.isCurrentWeek ? 'this week' : range}</span>
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

/**
 * Where a month sits in the lodgement chain. Rendered only in month view —
 * the week grid is for day-to-day entry and has no period of its own.
 *
 * `open` is the resting state and covers a month with no TimesheetPeriod row
 * at all, so this never has to distinguish "not started" from "no record".
 */
function PeriodStateChip({ state }: { state: TimesheetPeriodState }) {
  const copy: Record<TimesheetPeriodState, { label: string; className: string; title: string }> = {
    open: {
      label: 'Open',
      className: 'border-line text-ink-3',
      title: 'Still being logged. Lodge the month when it is complete.',
    },
    lodged: {
      label: 'Lodged',
      className: 'border-status-amber/40 bg-status-amber/10 text-status-amber',
      title: 'Submitted for approval. Waiting on the project leads.',
    },
    approved: {
      label: 'Approved',
      className: 'border-status-green/40 bg-status-green/10 text-status-green',
      title: 'Every entry in the month is approved.',
    },
    invoiced: {
      label: 'Invoiced',
      className: 'border-brand/40 bg-brand/10 text-brand',
      title: 'A contractor invoice has been raised for this month.',
    },
  };
  const c = copy[state];
  return (
    <span
      title={c.title}
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${c.className}`}
    >
      {c.label}
    </span>
  );
}
