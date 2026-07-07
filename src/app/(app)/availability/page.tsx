import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { getAvailabilityForecast } from '@/server/timesheet';
import { loadAvailabilityForPerson } from '@/server/availability';
import { addDays, startOfWeek, todayInFirmTz } from '@/lib/week';
import { PersonAvatar } from '@/components/person-avatar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AvailabilityEditor } from './availability-editor';
import { AvailabilityPersonPicker } from './person-picker';
import { RegularDaysEditor } from './regular-days-editor';
import { ScheduleTable } from './schedule-table';

/**
 * Availability forecast — split out from /timesheet so staff have a
 * dedicated, low-friction surface for "what can I work this period?".
 *
 * Section order (per TT, 2026-05-06):
 *   1. Projects in flight — simplified portfolio view at the top so
 *      staff get oriented before declaring availability.
 *   2. Editor — 4-week × 7-day grid of expected hours + a per-day note
 *      (drives Resource Planning bandwidth heatmap firm-wide).
 *   3. Schedule — read-only project allocation × baseline vs booked
 *      actuals, as a sanity check.
 *
 * On-behalf editing: super_admin / admin / partner / manager can pick
 * any active person via `?personId=…`. Self-edit always works.
 */
export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: { personId?: string };
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'timesheet.submit')) notFound();

  const isAdminGroup = hasAnyRole(session, ['super_admin', 'admin']);
  const isManagerOrLead = hasAnyRole(session, ['manager', 'partner']);
  const canActOnBehalf = isAdminGroup || isManagerOrLead;

  let target = session.person;
  let actingOnBehalf = false;
  if (
    searchParams.personId &&
    searchParams.personId !== session.person.id
  ) {
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
    if (!fetched || fetched.endDate !== null) notFound();
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

  // Picker options — same shape the timesheet page uses for on-behalf
  // edits. Admin sees everyone; manager/partner sees people on their
  // led projects.
  let teamOptions: Array<{
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
  }> = [];
  if (canActOnBehalf) {
    if (isAdminGroup) {
      teamOptions = await prisma.person.findMany({
        where: { endDate: null },
        orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
        select: {
          id: true,
          initials: true,
          headshotUrl: true,
          firstName: true,
          lastName: true,
        },
      });
    } else {
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
      const ids = new Set<string>();
      for (const p of ledProjects) {
        ids.add(p.managerId);
        ids.add(p.primaryPartnerId);
        for (const t of p.team) ids.add(t.personId);
      }
      ids.delete(session.person.id);
      teamOptions = ids.size
        ? await prisma.person.findMany({
            where: { id: { in: [...ids] }, endDate: null },
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

  // Inactive (soft-paused) gate — editor is disabled for inactive
  // profiles. We look up unconditionally so the same banner shows
  // whether you arrived via session or via on-behalf personId. Same
  // query also pulls the regular-days schedule for the panel above
  // the grid.
  const targetState = await prisma.person.findUnique({
    where: { id: target.id },
    select: {
      inactiveAt: true,
      isStaff: true,
      regularDaysEnabled: true,
      regularMonHours: true,
      regularTueHours: true,
      regularWedHours: true,
      regularThuHours: true,
      regularFriHours: true,
      regularSatHours: true,
      regularSunHours: true,
    },
  });
  const isInactive = targetState?.inactiveAt !== null && targetState?.inactiveAt !== undefined;
  const showRegularDays = targetState?.isStaff === true;
  const regularDays = {
    enabled: targetState?.regularDaysEnabled ?? false,
    mon: targetState?.regularMonHours ?? 0,
    tue: targetState?.regularTueHours ?? 0,
    wed: targetState?.regularWedHours ?? 0,
    thu: targetState?.regularThuHours ?? 0,
    fri: targetState?.regularFriHours ?? 0,
    sat: targetState?.regularSatHours ?? 0,
    sun: targetState?.regularSunHours ?? 0,
  };

  // Editor horizon — 8 weeks of rotated grid (per TT, 2026-05-07).
  // Schedule table stays at 4 weeks so it doesn't dominate the page.
  const EDITOR_WEEKS = 8;
  const SCHEDULE_WEEKS = 4;
  const forecast = await getAvailabilityForecast(target.id, SCHEDULE_WEEKS);
  const horizonStart = startOfWeek(todayInFirmTz());
  const initialCells = await loadAvailabilityForPerson(
    target.id,
    EDITOR_WEEKS,
  );
  const editorWeeks = Array.from({ length: EDITOR_WEEKS }, (_, i) => {
    const ws = addDays(horizonStart, i * 7);
    return {
      weekStartIso: ws.toISOString().slice(0, 10),
      label: ws.toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
      }),
    };
  });
  const targetCapacityHours = await (async () => {
    const p = await prisma.person.findUnique({
      where: { id: target.id },
      select: { fte: true, employment: true, band: true },
    });
    if (!p) return 0;
    // Leadership tier (Partner/MP/AP) + contractors opt out of the
    // pyramid-tracked FTE forecast — their hours come from project
    // allocation, not a default-FTE assumption.
    if (
      p.employment === 'contractor' ||
      p.band === 'Partner' ||
      p.band === 'MP' ||
      p.band === 'Associate_Partner' ||
      p.band === 'Support_Staff'
    )
      return 0;
    return Math.round(Number(p.fte ?? 1) * 38);
  })();

  // Projects in flight — simplified portfolio view. Includes everyone's
  // projects (not just `target`'s), kept compact so it doesn't compete
  // with the editor for attention. Stage filter excludes archived.
  const activeProjects = await prisma.project.findMany({
    where: { stage: { not: 'archived' } },
    orderBy: [{ stage: 'asc' }, { code: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      stage: true,
      startDate: true,
      endDate: true,
      client: { select: { code: true, legalName: true } },
      primaryPartner: {
        select: { id: true, initials: true, firstName: true, lastName: true, headshotUrl: true },
      },
      manager: {
        select: { id: true, initials: true, firstName: true, lastName: true, headshotUrl: true },
      },
      team: {
        select: { personId: true },
      },
    },
  });
  // "On" the project = team membership OR partner/manager.
  const onProjectIds = new Set(
    activeProjects
      .filter(
        (p) =>
          p.primaryPartner.id === target.id ||
          p.manager.id === target.id ||
          p.team.some((t) => t.personId === target.id),
      )
      .map((p) => p.id),
  );
  // The person's own projects sort first — both in the table below and
  // in every project dropdown the editor renders, so the code they
  // want is almost always the first option.
  const sortedProjects = activeProjects.slice().sort((a, b) => {
    const aMine = onProjectIds.has(a.id) ? 0 : 1;
    const bMine = onProjectIds.has(b.id) ? 0 : 1;
    if (aMine !== bMine) return aMine - bMine;
    return a.code.localeCompare(b.code);
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Availability forecast</h1>
          <p className="text-sm text-ink-3">
            Declare the hours you expect to work each week so partners
            can plan resourcing across the firm. Drives the resource-
            planning bandwidth heatmap.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/timesheet" className="text-ink-3 hover:text-ink">
            ← Back to timesheet
          </Link>
        </div>
      </header>

      {canActOnBehalf && teamOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-card px-3 py-2 text-sm">
          <span className="text-xs text-ink-3">Editing for</span>
          <AvailabilityPersonPicker
            selfId={session.person.id}
            selfFirstName={session.person.firstName}
            selfLastName={session.person.lastName}
            selectedPersonId={target.id}
            options={teamOptions}
          />
          {actingOnBehalf && (
            <Badge variant="amber" className="text-[10px]">
              On behalf
            </Badge>
          )}
        </div>
      )}

      {/* ── Projects in flight (simplified) — top of page per TT ───── */}
      <Card className="p-0">
        <CardHeader className="flex flex-row items-end justify-between gap-2">
          <div>
            <CardTitle>Projects in flight ({activeProjects.length})</CardTitle>
            <p className="text-[11px] text-ink-3">
              What&apos;s currently on the books across the firm and
              who&apos;s leading each piece. Highlighted rows are projects
              you&apos;re on.
            </p>
          </div>
        </CardHeader>
        {activeProjects.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-3">No active projects.</p>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-left">Project</th>
                <th className="px-4 py-2 text-left">Client</th>
                <th className="px-4 py-2 text-left">Stage</th>
                <th className="px-4 py-2 text-left">Lead partner</th>
                <th className="px-4 py-2 text-left">Project manager</th>
                <th className="px-4 py-2 text-right">Team</th>
                <th className="px-4 py-2 text-right">Dates</th>
              </tr>
            </thead>
            <tbody>
              {sortedProjects.map((p) => {
                const onThisProject = onProjectIds.has(p.id);
                const stageVariant: 'amber' | 'green' | 'blue' | 'outline' =
                  p.stage === 'kickoff'
                    ? 'amber'
                    : p.stage === 'delivery'
                      ? 'green'
                      : p.stage === 'closing'
                        ? 'blue'
                        : 'outline';
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-line last:border-b-0 ${
                      onThisProject ? 'bg-brand-soft/40' : ''
                    }`}
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/projects/${p.code}`}
                        className="font-mono text-xs text-ink hover:underline"
                      >
                        {p.code}
                      </Link>
                      <div className="text-ink">{p.name}</div>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">
                      <span className="font-mono text-[11px] text-ink-3">
                        {p.client.code}
                      </span>{' '}
                      {p.client.legalName}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={stageVariant} className="capitalize">
                        {p.stage}
                      </Badge>
                      {onThisProject && (
                        <Badge variant="blue" className="ml-1 text-[10px]">
                          You
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <PersonChip person={p.primaryPartner} />
                    </td>
                    <td className="px-4 py-2">
                      <PersonChip person={p.manager} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-xs text-ink-3">
                      {p.team.length}
                    </td>
                    <td className="px-4 py-2 text-right text-[11px] tabular-nums text-ink-3">
                      {p.startDate
                        ? p.startDate.toLocaleDateString('en-AU', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : '—'}{' '}
                      →{' '}
                      {p.endDate
                        ? p.endDate.toLocaleDateString('en-AU', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {/* ── Regular days — defaults the editor for permanent staff ─── */}
      {showRegularDays && !isInactive && (
        <RegularDaysEditor
          personId={target.id}
          targetFirstName={
            target.id === session.person.id ? 'You' : target.firstName
          }
          initial={regularDays}
        />
      )}

      {/* ── Editable forecast — 4-week × 7-day grid ────────────────── */}
      {isInactive ? (
        <div className="rounded-lg border border-status-amber bg-status-amber-soft/40 px-4 py-3 text-sm text-status-amber">
          <strong>
            {target.id === session.person.id
              ? 'Your profile is inactive'
              : `${target.firstName}'s profile is inactive`}
          </strong>
          <span className="ml-1 text-ink-2">
            — availability inputs are disabled.{' '}
            {target.id === session.person.id
              ? 'Reactivate from your profile to resume.'
              : 'Reactivate from their profile to resume.'}{' '}
            <Link
              href={`/directory/people/${target.id}`}
              className="underline hover:text-status-amber"
            >
              Open profile →
            </Link>
          </span>
        </div>
      ) : (
        <AvailabilityEditor
          // Remount when the person or their regular-days schedule
          // changes so the grid re-seeds its pre-filled defaults
          // immediately after a regular-days save (the editor holds
          // cell state in useState, which ignores prop updates).
          key={`${target.id}:${JSON.stringify(regularDays)}`}
          personId={target.id}
          targetFirstName={
            target.id === session.person.id ? 'You' : target.firstName
          }
          weeklyCapacityHours={targetCapacityHours}
          weeks={editorWeeks}
          initialCells={initialCells}
          allocatableProjects={sortedProjects.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
          }))}
        />
      )}

      {/* ── Read-only schedule + booked ──────────────────────────── */}
      <ScheduleTable weeks={forecast} targetFirstName={target.firstName} />
    </div>
  );
}

function PersonChip({
  person,
}: {
  person: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  };
}) {
  return (
    <Link
      href={`/directory/people/${person.id}`}
      className="flex items-center gap-1.5 hover:underline"
    >
      <PersonAvatar
        className="h-5 w-5"
        fallbackClassName="text-[9px]"
        initials={person.initials}
        headshotUrl={person.headshotUrl}
      />
      <span className="text-xs text-ink-2">
        {person.firstName} {person.lastName}
      </span>
    </Link>
  );
}

// Suppress unused-import lint when Avatar/AvatarFallback aren't otherwise
// referenced (they're available for future inline tweaks alongside
// PersonAvatar).
const _AvatarRef = Avatar;
const _AvatarFallbackRef = AvatarFallback;
void _AvatarRef;
void _AvatarFallbackRef;
