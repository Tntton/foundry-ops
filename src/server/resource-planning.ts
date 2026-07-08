import { prisma } from '@/server/db';
import { addDays, startOfWeek } from '@/lib/week';

export type ResourceWeek = {
  weekStart: Date; // Monday
  weekEnd: Date; // Sunday
  label: string;
};

export type ResourcePersonRow = {
  personId: string;
  initials: string;
  firstName: string;
  lastName: string;
  band: string;
  employment: 'ft' | 'contractor';
  fte: number | null;
  /** Soft-paused — capacity forced to 0, surfaces in dedicated pool
   *  bucket. */
  isInactive: boolean;
  weeklyCapacityHours: number; // 38h/week baseline × FTE; 0 for partner/contractor
  /** Sum of project allocation percentages × 38h, applied weekly. The
   *  partner/contractor schedule comes from the same compute — it's the
   *  planned hours the project team rosters them for, regardless of FTE. */
  weeklyAllocatedHours: number;
  headshotUrl: string | null;
  weeks: Array<{
    weekStart: Date;
    loggedHours: number;
    draftHours: number;
    submittedHours: number;
    approvedOrBilledHours: number;
    /** Hours this person is "free" in this week. For staff with a fixed
     *  capacity (FT employees), it's `capacity − max(allocated, booked)`.
     *  For partner/contractor (no fixed capacity), it's null — we can't
     *  tell what's unused without a ceiling. */
    latentHours: number | null;
    projectBreakdown: Array<{
      projectId: string;
      projectCode: string;
      projectName: string;
      hours: number;
    }>;
    utilisationPct: number | null; // logged / capacity × 100; null when capacity = 0
  }>;
  /** Aggregate-period totals so the page doesn't recompute from `weeks`. */
  totalCapacityHours: number;
  totalAllocatedHours: number;
  totalBookedHours: number;
  totalLatentHours: number | null;
  utilisationOfCapacityPct: number | null;
  /** No timesheet entries AND no project allocations across the horizon —
   *  the bench. Drives the "Not engaged" card on the dashboard. */
  isUnengaged: boolean;
  allocations: Array<{
    projectId: string;
    projectCode: string;
    projectName: string;
    allocationPct: number;
    roleOnProject: string;
  }>;
};

export type ResourcePlanning = {
  weeks: ResourceWeek[];
  rows: ResourcePersonRow[];
  firmCapacityHours: number;
  firmAllocatedHours: number;
  firmBookedHours: number;
  /** Capacity left unbooked across the firm — drives the headline KPI. */
  firmLatentHours: number;
  firmUtilisationPct: number | null;
  /** Subset of `rows` with zero allocations + zero bookings. */
  unengagedRows: ResourcePersonRow[];
};

const BASELINE_HOURS_PER_FTE_WEEK = 38; // AU consulting convention

export async function computeResourcePlanning(
  weeksAhead: number = 4,
  reference: Date = new Date(),
): Promise<ResourcePlanning> {
  const firstWeek = startOfWeek(reference);
  const weeks: ResourceWeek[] = Array.from({ length: weeksAhead }, (_, i) => {
    const s = addDays(firstWeek, i * 7);
    return {
      weekStart: s,
      weekEnd: addDays(s, 6),
      label: `${s.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`,
    };
  });
  const rangeStart = firstWeek;
  const rangeEnd = addDays(firstWeek, weeksAhead * 7);

  const [people, entries, assignments] = await Promise.all([
    // Resource planning is a utilisation surface — narrow to the
    // FT/PT employee subset (`isStaff`). Partners / fellows /
    // contractors are intentionally excluded; their capacity isn't a
    // metric we manage. Inactive (soft-paused) staff stay in the set
    // so the page can show them in their dedicated bucket; their
    // capacity is forced to 0 below.
    prisma.person.findMany({
      where: { endDate: null, isStaff: true },
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
      },
    }),
    prisma.timesheetEntry.findMany({
      where: {
        date: { gte: rangeStart, lt: rangeEnd },
        // Sandbox hours (TST* projects) don't count toward utilisation.
        NOT: { project: { code: { startsWith: 'TST' } } },
      },
      select: {
        personId: true,
        projectId: true,
        date: true,
        hours: true,
        status: true,
        project: { select: { code: true, name: true } },
      },
    }),
    prisma.projectTeam.findMany({
      where: { project: { stage: { not: 'archived' } } },
      include: { project: { select: { id: true, code: true, name: true, stage: true } } },
    }),
  ]);

  const allocationsByPerson = new Map<string, ResourcePersonRow['allocations']>();
  for (const a of assignments) {
    const list = allocationsByPerson.get(a.personId) ?? [];
    list.push({
      projectId: a.project.id,
      projectCode: a.project.code,
      projectName: a.project.name,
      allocationPct: a.allocationPct,
      roleOnProject: a.roleOnProject,
    });
    allocationsByPerson.set(a.personId, list);
  }

  const rows: ResourcePersonRow[] = people.map((p) => {
    const fte = p.fte !== null ? Number(p.fte) : null;
    const isInactive = p.inactiveAt !== null;
    // Inactive folks contribute 0 capacity / 0 allocation regardless of
    // their FTE — the row still gets emitted so the page can show them
    // in a dedicated bucket on the pool.
    const weeklyCapacity = isInactive
      ? 0
      : p.employment === 'contractor' ||
          p.band === 'Partner' ||
          p.band === 'MP' ||
          p.band === 'Associate_Partner'
        ? 0 // variable — no baseline (leadership + contractors)
        : Math.round((fte ?? 1) * BASELINE_HOURS_PER_FTE_WEEK);
    // Allocation-driven planned hours: each ProjectTeam.allocationPct is
    // expressed as a % of a 38h week, regardless of the person's FTE,
    // so a partner allocated 25% to a project = ~9.5h/week of planned
    // engagement. Sum across active project memberships gives the total
    // weekly bookable forecast.
    const personAllocations = allocationsByPerson.get(p.id) ?? [];
    const weeklyAllocatedHours = Math.round(
      personAllocations.reduce(
        (s, a) => s + (a.allocationPct / 100) * BASELINE_HOURS_PER_FTE_WEEK,
        0,
      ),
    );

    const weekBuckets = weeks.map((w) => {
      const weekEnd = addDays(w.weekStart, 7);
      const weekEntries = entries.filter(
        (e) =>
          e.personId === p.id &&
          e.date.getTime() >= w.weekStart.getTime() &&
          e.date.getTime() < weekEnd.getTime(),
      );

      let logged = 0;
      let draft = 0;
      let submitted = 0;
      let approvedOrBilled = 0;
      const byProject = new Map<
        string,
        { projectId: string; projectCode: string; projectName: string; hours: number }
      >();

      for (const e of weekEntries) {
        const hours = Number(e.hours);
        logged += hours;
        if (e.status === 'draft') draft += hours;
        else if (e.status === 'submitted') submitted += hours;
        else approvedOrBilled += hours;
        const entry =
          byProject.get(e.projectId) ??
          {
            projectId: e.projectId,
            projectCode: e.project.code,
            projectName: e.project.name,
            hours: 0,
          };
        entry.hours += hours;
        byProject.set(e.projectId, entry);
      }

      // Latent (this week) — capacity that's neither allocated nor
      // booked. For variable-capacity people (partner/contractor) we
      // can't compute it; the table shows "—" for those cells.
      const latent =
        weeklyCapacity > 0
          ? Math.max(0, weeklyCapacity - Math.max(weeklyAllocatedHours, logged))
          : null;
      return {
        weekStart: w.weekStart,
        loggedHours: logged,
        draftHours: draft,
        submittedHours: submitted,
        approvedOrBilledHours: approvedOrBilled,
        latentHours: latent,
        projectBreakdown: Array.from(byProject.values()).sort(
          (a, b) => b.hours - a.hours,
        ),
        utilisationPct:
          weeklyCapacity > 0 ? Math.round((logged / weeklyCapacity) * 100) : null,
      };
    });

    const totalCapacityHours = weeklyCapacity * weeks.length;
    const totalAllocatedHours = weeklyAllocatedHours * weeks.length;
    const totalBookedHours = weekBuckets.reduce((s, w) => s + w.loggedHours, 0);
    const totalLatentHours =
      totalCapacityHours > 0
        ? Math.max(0, totalCapacityHours - Math.max(totalAllocatedHours, totalBookedHours))
        : null;
    const utilisationOfCapacityPct =
      totalCapacityHours > 0
        ? Math.round((totalBookedHours / totalCapacityHours) * 100)
        : null;
    // "Unengaged" = on the books but nothing scheduled and nothing
    // logged across the horizon. Partner/contractor counted only when
    // there's truly zero activity (they have no fixed capacity to
    // benchmark against, but zero everything is still telling).
    // Inactive (soft-paused) people always count as unengaged so they
    // surface in the pool even if a stale ProjectTeam membership remains.
    const isUnengaged =
      isInactive ||
      (totalAllocatedHours === 0 && totalBookedHours === 0);

    return {
      personId: p.id,
      initials: p.initials,
      firstName: p.firstName,
      lastName: p.lastName,
      band: p.band,
      employment: p.employment,
      fte,
      isInactive,
      weeklyCapacityHours: weeklyCapacity,
      weeklyAllocatedHours,
      weeks: weekBuckets,
      totalCapacityHours,
      totalAllocatedHours,
      totalBookedHours,
      totalLatentHours,
      utilisationOfCapacityPct,
      isUnengaged,
      allocations: personAllocations,
      headshotUrl: p.headshotUrl,
    };
  });

  const firmCapacity = rows.reduce((s, r) => s + r.totalCapacityHours, 0);
  const firmAllocated = rows.reduce((s, r) => s + r.totalAllocatedHours, 0);
  const firmBooked = rows.reduce((s, r) => s + r.totalBookedHours, 0);
  // Firm-level latent — only counts staff with a fixed capacity. Partners
  // / contractors are excluded since their ceiling is variable.
  const firmLatent = rows.reduce(
    (s, r) => s + (r.totalLatentHours ?? 0),
    0,
  );
  const firmUtilisationPct =
    firmCapacity > 0 ? Math.round((firmBooked / firmCapacity) * 100) : null;
  const unengagedRows = rows.filter((r) => r.isUnengaged);

  return {
    weeks,
    rows,
    firmCapacityHours: firmCapacity,
    firmAllocatedHours: firmAllocated,
    firmBookedHours: firmBooked,
    firmLatentHours: firmLatent,
    firmUtilisationPct,
    unengagedRows,
  };
}
