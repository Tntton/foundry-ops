import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import { computeResourcePlanning } from '@/server/resource-planning';
import {
  computeBandwidthHeatmap,
  type BandwidthRow,
} from '@/server/availability';
import { computeFirmUtilisation } from '@/server/reports/utilisation';
import { computePoolStatus } from '@/server/pool-status';
import type { PoolStatus } from '@prisma/client';
import { PersonAvatar } from '@/components/person-avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PoolChip } from './pool-chip';

/**
 * Resource planning — bandwidth heatmap is the headline (per TT,
 * 2026-05-07). Page leads with people who've actually submitted a
 * forecast so partners can immediately see who's full / who's free, with
 * each person's current project list inline. Below: the "not engaged"
 * bench, bucketed by FTE / employment so partners can plan recruiting
 * vs. utilisation in one glance.
 */

const WEEK_OPTIONS = [4, 6, 8, 12] as const;

/** Compact label for an FTE / employment / role bucket — used to group
 *  the pool card into actionable cohorts.
 *
 *  Full-time staff at 1.0 FTE break out by role (the "Team" cohort):
 *  Analysts, Consultants, Experts/Fellows, Admin. Admin is identified
 *  via the `admin` role (not the band) because operations / office-
 *  manager folks come in across various bands. */
function allocationBucket(p: {
  fte: number | null;
  employment: 'ft' | 'contractor';
  band: string;
  roles: string[];
  isInactive: boolean;
  isStaff: boolean;
}): { key: string; label: string; sortKey: number } {
  // Inactive (soft-paused) wins over every other classification — these
  // folks aren't generating capacity until they reactivate.
  if (p.isInactive)
    return { key: 'inactive', label: 'Inactive', sortKey: 0 };
  // Leadership tier (Partner / MP / Associate Partner) — distinct
  // from staff utilisation tracking. APs sit in the same band group
  // since their delivery-leadership role mirrors partner's; the
  // partner scorecard surface (firm-wide attribution) is what
  // distinguishes them, not this utilisation cohort.
  if (p.band === 'Partner' || p.band === 'MP' || p.band === 'Associate_Partner')
    return { key: 'partner', label: 'Partner / AP / MP', sortKey: 95 };
  // Support staff (Office Manager etc.) — not on the delivery pyramid;
  // surface in their own group at the bottom rather than mixing with
  // billable bands.
  if (p.band === 'Support_Staff')
    return { key: 'support', label: 'Support staff', sortKey: 98 };
  // Contractors break out by role so partners can see how the bench is
  // composed (consultants vs experts/fellows vs analysts).
  if (p.employment === 'contractor') {
    if (p.band === 'Analyst')
      return {
        key: 'contractor_analyst',
        label: 'Contractor · Analysts',
        sortKey: 51,
      };
    if (p.band === 'Consultant')
      return {
        key: 'contractor_consultant',
        label: 'Contractor · Consultants',
        sortKey: 52,
      };
    if (p.band === 'Expert')
      return {
        key: 'contractor_expert',
        label: 'Contractor · Experts / Fellows',
        sortKey: 53,
      };
    return {
      key: 'contractor_other',
      label: 'Contractor · Other',
      sortKey: 55,
    };
  }
  if (p.fte === null)
    return { key: 'unknown', label: 'No FTE set', sortKey: 99 };
  if (p.fte >= 1.0) {
    // Team — split by primary function. Admin role wins over band so
    // ops staff don't get mis-grouped as Consultants/Analysts.
    const isAdmin = p.roles.some(
      (r) => r === 'admin' || r === 'super_admin',
    );
    if (isAdmin && p.band !== 'Partner' && p.band !== 'MP')
      return { key: 'team_admin', label: 'Team · Admin', sortKey: 14 };
    if (p.band === 'Analyst')
      return { key: 'team_analyst', label: 'Team · Analysts', sortKey: 11 };
    if (p.band === 'Consultant')
      return { key: 'team_consultant', label: 'Team · Consultants', sortKey: 12 };
    if (p.band === 'Expert')
      return {
        key: 'team_expert',
        label: 'Team · Experts / Fellows',
        sortKey: 13,
      };
    return { key: 'team_other', label: 'Team · Other', sortKey: 15 };
  }
  if (p.fte >= 0.6)
    return { key: 'fte_06', label: '0.6–0.99 FTE', sortKey: 20 };
  if (p.fte >= 0.4)
    return {
      key: 'part_time_consultant',
      label: 'Part-time Consultant',
      sortKey: 30,
    };
  return { key: 'fte_lt04', label: '<0.4 FTE', sortKey: 40 };
}

/**
 * Buckets that should always render in the pool, even when empty —
 * anchors the pool's information architecture so partners scanning the
 * card know which cohorts exist regardless of who's currently
 * assigned. Empty buckets render with a "NIL" placeholder.
 */
const ALWAYS_RENDER_POOL_BUCKETS: Array<{
  key: string;
  label: string;
  sortKey: number;
}> = [
  {
    key: 'part_time_consultant',
    label: 'Part-time Consultant',
    sortKey: 30,
  },
];

const DAY_OF_WEEK_LABEL = 'Mon'; // each heatmap column = a Mon-Sun week

export default async function ResourcePlanningPage({
  searchParams,
}: {
  searchParams: { weeks?: string };
}) {
  const session = await getSession();
  if (
    !session ||
    !hasAnyRole(session, ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'])
  ) {
    notFound();
  }
  // Support_Staff hold admin role for ops work but the bandwidth
  // heatmap is a delivery-side tool with no relevance to them — match
  // the nav-config denyBands rule here as a page-level defense.
  if (session.person.band === 'Support_Staff') notFound();

  const weeksAhead = (() => {
    const n = Number(searchParams.weeks);
    return WEEK_OPTIONS.includes(n as (typeof WEEK_OPTIONS)[number]) ? n : 6;
  })();

  // Sequential to stay within the pgbouncer pool.
  const heatmap = await computeBandwidthHeatmap(weeksAhead);
  const data = await computeResourcePlanning(weeksAhead);

  // Active project memberships per person — drives the "Current projects"
  // column on each heatmap row (replacing the previous Avg util cell).
  const memberships = await prisma.projectTeam.findMany({
    where: { project: { stage: { not: 'archived' } } },
    select: {
      personId: true,
      allocationPct: true,
      project: {
        select: { id: true, code: true, name: true, stage: true },
      },
    },
  });
  type ProjectChip = {
    id: string;
    code: string;
    name: string;
    stage: string;
    pct: number;
  };
  const projectsByPerson = new Map<string, ProjectChip[]>();
  for (const m of memberships) {
    const arr = projectsByPerson.get(m.personId) ?? [];
    arr.push({
      id: m.project.id,
      code: m.project.code,
      name: m.project.name,
      stage: m.project.stage,
      pct: m.allocationPct,
    });
    projectsByPerson.set(m.personId, arr);
  }
  // Sort each person's projects by allocation desc.
  for (const [, arr] of projectsByPerson) {
    arr.sort((a, b) => b.pct - a.pct);
  }

  // Heatmap rows — show every permanent staff member always. Drop the
  // hasAnyForecast filter (per TT, 2026-05-07): with regular-days
  // defaults wired up, even silent weeks render meaningfully, and the
  // empty cells make the "needs forecast" gap visually obvious.
  const forecastRows = heatmap.rows;

  // Pool data sources:
  //   1. data.unengagedRows — the staff (isStaff) bench from
  //      computeResourcePlanning.
  //   2. nonStaffPeople — every contractor / partner / fellow not on
  //      the heatmap, so the pool reflects the full "who can we pull
  //      in?" set bucketed by their role.
  type PoolEntry = {
    personId: string;
    initials: string;
    firstName: string;
    lastName: string;
    band: string;
    fte: number | null;
    employment: 'ft' | 'contractor';
    isInactive: boolean;
    isStaff: boolean;
    headshotUrl: string | null;
    roles: string[];
    /** Hours-free hint for staff (zero for non-staff variable capacity). */
    weeklyCapacityHours: number;
    /** Effective engagement status — drives the pool-chip colour pip. */
    poolStatus: PoolStatus;
    /** True when poolStatusOverride is non-null (super_admin pinned the
     *  status manually). Surfaces the ⊕ glyph on the chip. */
    hasPoolStatusOverride: boolean;
  };
  const nonStaffPeople = await prisma.person.findMany({
    where: { endDate: null, isStaff: false },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      initials: true,
      headshotUrl: true,
      firstName: true,
      lastName: true,
      band: true,
      employment: true,
      fte: true,
      inactiveAt: true,
      roles: true,
      poolStatusOverride: true,
    },
  });
  // Aggregate activity per person — needed to compute pool status when
  // there's no override. Active project membership is the strongest
  // signal; historical timesheet entries cover "previous_project".
  const allPoolPersonIds = [
    ...data.unengagedRows.map((r) => r.personId),
    ...nonStaffPeople.map((p) => p.id),
  ];
  const [activeMemberships, historicalEntries, overrides] = await Promise.all([
    allPoolPersonIds.length === 0
      ? Promise.resolve([])
      : prisma.projectTeam.findMany({
          where: {
            personId: { in: allPoolPersonIds },
            project: { stage: { not: 'archived' } },
          },
          select: { personId: true },
        }),
    allPoolPersonIds.length === 0
      ? Promise.resolve([])
      : prisma.timesheetEntry.findMany({
          where: { personId: { in: allPoolPersonIds } },
          select: { personId: true },
          take: 1,
          // Just need existence per person — this is a coarse signal,
          // we re-fetch per-person below using groupBy for accuracy.
        }),
    allPoolPersonIds.length === 0
      ? Promise.resolve([])
      : prisma.person.findMany({
          where: { id: { in: allPoolPersonIds } },
          select: { id: true, poolStatusOverride: true },
        }),
  ]);
  const activeProjectPersons = new Set(
    activeMemberships.map((m) => m.personId),
  );
  // Use groupBy for an accurate "any historical timesheet" check per
  // person — single round-trip instead of N findFirsts.
  const historyGrouped =
    allPoolPersonIds.length === 0
      ? []
      : await prisma.timesheetEntry.groupBy({
          by: ['personId'],
          where: { personId: { in: allPoolPersonIds } },
          _count: { _all: true },
        });
  const personsWithHistory = new Set(historyGrouped.map((g) => g.personId));
  const overrideByPerson = new Map(
    overrides.map((o) => [o.id, o.poolStatusOverride]),
  );
  // Drop the unused `historicalEntries` reference now that groupBy
  // covers it; keeps the imports list lean.
  void historicalEntries;

  // Roles for the staff bench — needed to split Team · Admin out from
  // band-based Analyst/Consultant/Expert.
  const unengagedIds = data.unengagedRows.map((r) => r.personId);
  const rolesById = new Map<string, string[]>();
  if (unengagedIds.length > 0) {
    const roleRows = await prisma.person.findMany({
      where: { id: { in: unengagedIds } },
      select: { id: true, roles: true },
    });
    for (const r of roleRows) rolesById.set(r.id, r.roles);
  }

  function statusFor(personId: string): {
    poolStatus: PoolStatus;
    hasPoolStatusOverride: boolean;
  } {
    const override = overrideByPerson.get(personId) ?? null;
    return {
      poolStatus: computePoolStatus({
        override,
        hasActiveProject: activeProjectPersons.has(personId),
        hasAnyProjectHistory: personsWithHistory.has(personId),
      }),
      hasPoolStatusOverride: override !== null,
    };
  }
  const poolEntries: PoolEntry[] = [
    ...data.unengagedRows.map((r) => ({
      personId: r.personId,
      initials: r.initials,
      firstName: r.firstName,
      lastName: r.lastName,
      band: r.band,
      fte: r.fte,
      employment: r.employment,
      isInactive: r.isInactive,
      isStaff: true,
      headshotUrl: r.headshotUrl,
      roles: rolesById.get(r.personId) ?? [],
      weeklyCapacityHours: r.weeklyCapacityHours,
      ...statusFor(r.personId),
    })),
    ...nonStaffPeople.map((p) => ({
      personId: p.id,
      initials: p.initials,
      firstName: p.firstName,
      lastName: p.lastName,
      band: p.band,
      fte: p.fte !== null ? Number(p.fte) : null,
      employment: p.employment,
      isInactive: p.inactiveAt !== null,
      isStaff: false,
      headshotUrl: p.headshotUrl,
      roles: p.roles,
      weeklyCapacityHours: 0,
      ...statusFor(p.id),
    })),
  ];

  // Bucket the entire pool by allocation cohort.
  const unengagedBuckets = new Map<
    string,
    { label: string; sortKey: number; rows: PoolEntry[] }
  >();
  for (const r of poolEntries) {
    const b = allocationBucket({
      fte: r.fte,
      employment: r.employment,
      band: r.band,
      roles: r.roles,
      isInactive: r.isInactive,
      isStaff: r.isStaff,
    });
    const cur = unengagedBuckets.get(b.key) ?? {
      label: b.label,
      sortKey: b.sortKey,
      rows: [],
    };
    cur.rows.push(r);
    unengagedBuckets.set(b.key, cur);
  }
  // Anchor buckets that should always render even when empty — keeps
  // the pool's information architecture stable so partners can see
  // "Part-time Consultant: NIL" when Sarah is utilised on a project,
  // rather than the cohort silently disappearing.
  for (const anchor of ALWAYS_RENDER_POOL_BUCKETS) {
    if (!unengagedBuckets.has(anchor.key)) {
      unengagedBuckets.set(anchor.key, { ...anchor, rows: [] });
    }
  }
  const unengagedBucketList = Array.from(unengagedBuckets.values()).sort(
    (a, b) => a.sortKey - b.sortKey,
  );

  // Utilisation report (consolidated from /utilisation per TT,
  // 2026-05-07) — current month, staff only. Loaded sequentially after
  // the bigger queries above.
  const utilisation = await computeFirmUtilisation();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Resource planning</h1>
          <p className="text-sm text-ink-3">
            Bandwidth across the next {weeksAhead} weeks for everyone who
            has submitted an availability forecast. Below the heatmap, the
            pool (no allocations & no hours logged), grouped by allocation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1 rounded-md border border-line bg-card p-1">
            {WEEK_OPTIONS.map((w) => (
              <Link
                key={w}
                href={`/resource-planning?weeks=${w}`}
                className={`rounded px-2 py-1 transition-colors ${
                  weeksAhead === w
                    ? 'bg-brand text-brand-ink'
                    : 'text-ink-2 hover:bg-surface-hover'
                }`}
              >
                {w}w
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* ── Bandwidth heatmap (top of page per TT) ─────────────────── */}
      <BandwidthHeatmapCard
        weeks={heatmap.weeks}
        rows={forecastRows}
        totalActive={heatmap.rows.length}
        projectsByPerson={projectsByPerson}
        unallocatedForecastHours={heatmap.totals.unallocatedForecastHours}
        allocatedForecastHours={heatmap.totals.allocatedForecastHours}
      />

      {/* ── Pool — bench + contractors bucketed by allocation ─────── */}
      {/* Card always renders when there are entries OR when an anchor
           bucket (e.g. Part-time Consultant) is configured to surface
           even when empty. */}
      {(poolEntries.length > 0 ||
        ALWAYS_RENDER_POOL_BUCKETS.length > 0) && (
        <Card className="border-status-amber/50 bg-status-amber-soft/20">
          <CardHeader>
            <CardTitle className="text-sm">
              Pool · {poolEntries.length}
            </CardTitle>
            <p className="text-[11px] text-ink-3">
              Everyone available to pull onto a project — bench staff plus
              contractors / fellows / partners — grouped by allocation
              category. Inactive (soft-paused) profiles surface at the top.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {unengagedBucketList.map((b) => (
              <div key={b.label}>
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                    {b.label}
                  </h4>
                  <span className="text-[10px] text-ink-3">
                    {b.rows.length === 0 ? 'NIL' : b.rows.length}
                  </span>
                </div>
                {b.rows.length === 0 ? (
                  <div className="rounded-md border border-dashed border-line bg-card/50 px-3 py-2 text-[11px] text-ink-3">
                    NIL — no-one currently in this cohort. Cohort stays
                    visible so the bucket isn&apos;t lost when everyone
                    is utilised.
                  </div>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {b.rows.map((r) => (
                      <li key={r.personId}>
                        <PoolChip
                          personId={r.personId}
                          initials={r.initials}
                          firstName={r.firstName}
                          lastName={r.lastName}
                          headshotUrl={r.headshotUrl}
                          effectiveStatus={r.poolStatus}
                          hasOverride={r.hasPoolStatusOverride}
                          canOverride={session.isRealSuperAdmin}
                          currentProjectCodes={(
                            projectsByPerson.get(r.personId) ?? []
                          ).map((p) => p.code)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Utilisation report (consolidated from /utilisation) ──── */}
      <UtilisationCard data={utilisation} />
    </div>
  );
}

// ─── Utilisation report (consolidated from /utilisation) ────────────

function utilBadgeTone(pct: number | null): {
  bg: string;
  text: string;
} {
  if (pct === null) return { bg: 'bg-surface-subtle', text: 'text-ink-4' };
  if (pct >= 110) return { bg: 'bg-status-red-soft', text: 'text-status-red' };
  if (pct >= 80)
    return { bg: 'bg-status-green-soft', text: 'text-status-green' };
  if (pct >= 50)
    return { bg: 'bg-status-amber-soft', text: 'text-status-amber' };
  return { bg: 'bg-surface-subtle', text: 'text-ink-3' };
}

function UtilisationCard({
  data,
}: {
  data: Awaited<ReturnType<typeof computeFirmUtilisation>>;
}) {
  const monthLabel = (() => {
    const [y, m] = data.month.split('-');
    if (!y || !m) return data.month;
    const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
    return d.toLocaleDateString('en-AU', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  })();
  return (
    <Card className="p-0">
      <CardHeader className="flex flex-row items-end justify-between gap-2">
        <div>
          <CardTitle>Utilisation · {monthLabel}</CardTitle>
          <p className="text-[11px] text-ink-3">
            Approved + billed hours vs target (FTE × 160h/month) for staff
            only. Target scales pro-rata for joiners / leavers mid-month.
          </p>
        </div>
        <div className="hidden gap-2 md:flex">
          <UtilSummaryChip
            label="Headcount"
            value={String(data.totals.activeHeadcount)}
          />
          <UtilSummaryChip
            label="Target hrs"
            value={data.totals.targetHours.toFixed(0)}
          />
          <UtilSummaryChip
            label="Logged"
            value={data.totals.loggedHours.toFixed(0)}
          />
          <UtilSummaryChip
            label="Firm util."
            value={
              data.totals.utilisationPct === null
                ? '—'
                : `${data.totals.utilisationPct}%`
            }
            tone={
              data.totals.utilisationPct === null
                ? 'neutral'
                : data.totals.utilisationPct < 60
                  ? 'amber'
                  : 'green'
            }
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {data.rows.length === 0 ? (
          <p className="px-6 py-6 text-center text-sm text-ink-3">
            No active staff this month.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
                <tr className="border-y border-line">
                  <th className="px-4 py-2 text-left">Person</th>
                  <th className="px-4 py-2 text-right">FTE</th>
                  <th className="px-4 py-2 text-right">Target</th>
                  <th className="px-4 py-2 text-right">Logged</th>
                  <th className="px-4 py-2 text-left">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const tone = utilBadgeTone(r.utilisationPct);
                  const maxBarPct = Math.min(
                    200,
                    Math.max(0, r.utilisationPct ?? 0),
                  );
                  return (
                    <tr
                      key={r.personId}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className="px-4 py-2">
                        <Link
                          href={`/directory/people/${r.personId}`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <PersonAvatar
                            className="h-6 w-6"
                            fallbackClassName="text-[10px]"
                            initials={r.initials}
                            headshotUrl={r.headshotUrl}
                          />
                          <span className="text-ink">
                            {r.firstName} {r.lastName}
                          </span>
                          <span className="text-[10px] text-ink-3">
                            · {r.band}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs text-ink-3">
                        {r.fte.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs text-ink-3">
                        {r.targetHours.toFixed(0)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">
                        {r.loggedHours.toFixed(0)}
                        {r.billedHours > 0 && (
                          <span className="ml-1 text-[10px] text-ink-3">
                            ({r.billedHours.toFixed(0)} billed)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
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
                            />
                            <div
                              className="absolute top-0 h-2 w-[1px] bg-ink-3"
                              style={{ left: '50%' }}
                            />
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${tone.bg} ${tone.text}`}
                          >
                            {r.utilisationPct === null
                              ? '—'
                              : `${r.utilisationPct}%`}
                          </span>
                        </div>
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

function UtilSummaryChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'amber' | 'green';
}) {
  const cls =
    tone === 'amber'
      ? 'border-status-amber text-status-amber'
      : tone === 'green'
        ? 'border-status-green text-status-green'
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

// ─── Bandwidth heatmap ────────────────────────────────────────────────

function bucketStyles(pct: number | null): {
  bg: string;
  text: string;
} {
  if (pct === null) return { bg: 'bg-surface-subtle', text: 'text-ink-4' };
  if (pct === 0) return { bg: 'bg-surface-subtle', text: 'text-ink-3' };
  if (pct < 40) return { bg: 'bg-status-blue-soft/50', text: 'text-ink-2' };
  if (pct < 70) return { bg: 'bg-status-blue-soft', text: 'text-status-blue' };
  if (pct <= 95) return { bg: 'bg-status-green-soft', text: 'text-status-green' };
  if (pct <= 105)
    return { bg: 'bg-status-amber-soft', text: 'text-status-amber' };
  return { bg: 'bg-status-red-soft', text: 'text-status-red' };
}

function projectStageTone(stage: string): string {
  if (stage === 'kickoff') return 'border-status-amber/40 text-status-amber';
  if (stage === 'delivery') return 'border-status-green/40 text-status-green';
  if (stage === 'closing') return 'border-status-blue/40 text-status-blue';
  return 'border-line text-ink-3';
}

type ProjectChipForRow = {
  id: string;
  code: string;
  name: string;
  stage: string;
  pct: number;
};

function BandwidthHeatmapCard({
  weeks,
  rows,
  totalActive,
  projectsByPerson,
  unallocatedForecastHours,
  allocatedForecastHours,
}: {
  weeks: Array<{ weekStart: Date; label: string }>;
  rows: BandwidthRow[];
  totalActive: number;
  projectsByPerson: Map<string, ProjectChipForRow[]>;
  unallocatedForecastHours: number;
  allocatedForecastHours: number;
}) {
  const totalForecast = unallocatedForecastHours + allocatedForecastHours;
  const freePct =
    totalForecast > 0
      ? Math.round((unallocatedForecastHours / totalForecast) * 100)
      : 0;
  return (
    <Card className="p-0">
      <CardHeader className="flex flex-row items-end justify-between gap-2">
        <div>
          <CardTitle>Bandwidth heatmap</CardTitle>
          <p className="text-[11px] text-ink-3">
            Hours per week from each staff member&apos;s availability
            forecast. {rows.length} of {totalActive} active staff have
            submitted. Cell colour shows utilisation against capacity.
            The green bar under each cell is the fraction earmarked to
            a project; the muted portion is unallocated (spare
            bandwidth ready to staff).
          </p>
        </div>
        <span className="hidden text-[11px] text-ink-3 md:inline">
          green 70–95% · amber 95–105% · red &gt;105% · blue &lt;70%
        </span>
      </CardHeader>

      {/* Split summary — headline "how much spare bandwidth is on the
           market this window" number, sits between header and table so
           you see it before you scroll into the grid. */}
      {totalForecast > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-subtle/60 px-6 py-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-ink-3">Forecast hours across window:</span>
            <span className="font-semibold tabular-nums text-ink">
              {Math.round(totalForecast)}h
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm bg-brand" aria-hidden />
            <span className="text-ink-3">Allocated to projects</span>
            <span className="font-semibold tabular-nums text-ink">
              {Math.round(allocatedForecastHours)}h
            </span>
            <span className="text-ink-3">({100 - freePct}%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm bg-ink-4/40" aria-hidden />
            <span className="text-ink-3">Free · ready to allocate</span>
            <span className="font-semibold tabular-nums text-ink">
              {Math.round(unallocatedForecastHours)}h
            </span>
            <span className="text-ink-3">({freePct}%)</span>
          </div>
          {/* Full-width proportion bar so the split reads at a glance
               even without hovering into a cell. */}
          <div
            aria-hidden
            className="ml-auto flex h-1.5 w-40 overflow-hidden rounded-sm bg-ink-4/30"
            title={`Allocated ${Math.round(allocatedForecastHours)}h · Free ${Math.round(unallocatedForecastHours)}h`}
          >
            <div
              className="h-full bg-brand"
              style={{ width: `${100 - freePct}%` }}
            />
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <CardContent>
          <p className="text-sm text-ink-3">
            No-one has submitted a forecast yet for this horizon. Once
            staff fill out{' '}
            <Link href="/availability" className="text-brand hover:underline">
              /availability
            </Link>
            , they&apos;ll appear here.
          </p>
        </CardContent>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left">Person</th>
                  {weeks.map((w) => (
                    <th
                      key={w.weekStart.toISOString()}
                      className="px-2 py-1.5 text-center"
                    >
                      <div className="text-[9px] font-medium uppercase tracking-wide text-ink-3">
                        {DAY_OF_WEEK_LABEL}
                      </div>
                      <div className="font-mono text-[11px] text-ink-2">
                        {w.label}
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-2 text-left">Current projects</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <BandwidthRowView
                    key={row.personId}
                    row={row}
                    projects={projectsByPerson.get(row.personId) ?? []}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line bg-surface-subtle/40 px-4 py-2 text-[10px] text-ink-3">
            <span className="mr-2 font-semibold uppercase tracking-wide">
              Legend
            </span>
            <LegendDot className="bg-status-blue-soft/50" /> &lt;40%
            <span className="mx-2 text-ink-4">·</span>
            <LegendDot className="bg-status-blue-soft" /> 40–70%
            <span className="mx-2 text-ink-4">·</span>
            <LegendDot className="bg-status-green-soft" /> 70–95%
            <span className="mx-2 text-ink-4">·</span>
            <LegendDot className="bg-status-amber-soft" /> 95–105%
            <span className="mx-2 text-ink-4">·</span>
            <LegendDot className="bg-status-red-soft" /> &gt;105%
          </div>
        </>
      )}
    </Card>
  );
}

function LegendDot({ className }: { className: string }) {
  return (
    <span
      className={`mx-1 inline-block h-2.5 w-2.5 rounded-sm align-middle ${className}`}
    />
  );
}

function BandwidthRowView({
  row,
  projects,
}: {
  row: BandwidthRow;
  projects: ProjectChipForRow[];
}) {
  const fteLabel =
    row.fte !== null ? `FTE ${row.fte.toFixed(1)}` : 'Variable';
  return (
    <tr className="border-b border-line last:border-b-0 align-top">
      <td className="px-4 py-2">
        <Link
          href={`/directory/people/${row.personId}`}
          className="flex items-center gap-2 hover:underline"
        >
          <PersonAvatar
            className="h-7 w-7"
            fallbackClassName="text-[10px]"
            initials={row.initials}
            headshotUrl={row.headshotUrl}
          />
          <div>
            <div className="text-ink">
              {row.firstName} {row.lastName}
            </div>
            <div className="text-[10px] text-ink-3">
              {row.band} · {fteLabel}
            </div>
          </div>
        </Link>
      </td>
      {row.cells.map((c) => (
        <td
          key={c.weekStart.toISOString()}
          className="px-1.5 py-2 text-center"
        >
          <BandwidthCellView cell={c} />
        </td>
      ))}
      <td className="px-4 py-2 text-xs text-ink-3">
        {projects.length === 0 ? (
          <span className="text-[10px] uppercase tracking-wide text-status-amber">
            No active projects
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.code}`}
                title={`${p.name} · ${p.stage}`}
                className={`inline-flex items-center gap-1 rounded-full border bg-surface-elev px-2 py-0.5 text-[11px] hover:bg-surface-hover ${projectStageTone(p.stage)}`}
              >
                <span className="font-mono">{p.code}</span>
                <span className="text-ink-3">·</span>
                <span className="tabular-nums">{p.pct}%</span>
              </Link>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

function BandwidthCellView({
  cell,
}: {
  cell: BandwidthRow['cells'][number];
}) {
  const styles = bucketStyles(cell.utilisationPct);
  if (
    cell.capacityHours === 0 &&
    !cell.hasForecast &&
    !cell.hasBooking
  ) {
    return <span className="text-[10px] text-ink-4">—</span>;
  }
  if (
    cell.effectiveHours === 0 &&
    cell.capacityHours > 0 &&
    !cell.hasForecast
  ) {
    return (
      <div
        title={`No forecast / no bookings (capacity ${cell.capacityHours}h)`}
        className="mx-auto flex h-9 w-12 flex-col items-center justify-center rounded border border-dashed border-line text-[10px] text-ink-4"
      >
        —
      </div>
    );
  }
  // Split-bar underneath the numbers: shows what portion of the
  // week's forecast hours is committed to a project (Foundry green)
  // vs unallocated (muted grey). Only rendered when a forecast is
  // present with a non-zero split; keeps the cell quiet otherwise.
  const totalForecast = cell.hasForecast ? (cell.forecastHours ?? 0) : 0;
  const allocPct =
    totalForecast > 0
      ? Math.round((cell.allocatedForecastHours / totalForecast) * 100)
      : 0;
  const showSplitBar =
    cell.hasForecast && totalForecast > 0 && cell.allocatedForecastHours + cell.unallocatedForecastHours > 0;

  return (
    <div
      className={`mx-auto flex h-9 w-12 flex-col items-center justify-center rounded ${styles.bg}`}
      title={
        cell.hasForecast
          ? `Forecast ${cell.effectiveHours}h · ${cell.utilisationPct ?? '—'}%\nAllocated: ${cell.allocatedForecastHours}h · Free: ${cell.unallocatedForecastHours}h`
          : `Booked ${cell.effectiveHours}h · ${cell.utilisationPct ?? '—'}%`
      }
    >
      <span className={`text-xs font-semibold tabular-nums ${styles.text}`}>
        {Math.round(cell.effectiveHours)}
      </span>
      {cell.utilisationPct !== null && (
        <span className={`text-[9px] tabular-nums ${styles.text}`}>
          {cell.utilisationPct}%
        </span>
      )}
      {showSplitBar && (
        <div
          aria-hidden
          className="mt-0.5 flex h-[3px] w-9 overflow-hidden rounded-sm bg-ink-4/40"
        >
          <div
            className="h-full bg-brand"
            style={{ width: `${allocPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
