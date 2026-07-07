import { prisma } from '@/server/db';
import { addDays, startOfWeek } from '@/lib/week';

export type BandwidthCell = {
  weekStart: Date;
  /** Sum of submitted forecast hours across the 7 days. null when no
   *  AvailabilityForecast row exists for any day in the week. */
  forecastHours: number | null;
  /** Portion of forecastHours earmarked against a specific Project
   *  (AvailabilityForecast.projectId !== null). 0 when nothing is
   *  allocated yet, even if forecast is submitted. */
  allocatedForecastHours: number;
  /** Portion of forecastHours with no Project attached - spare
   *  bandwidth the resource planning team can staff. This is the
   *  headline number for "who has room this week". */
  unallocatedForecastHours: number;
  /** Sum of timesheet entries for the week. */
  bookedHours: number;
  /** Forecast preferred when present; falls back to booked actuals so
   *  the heatmap still lights up before staff submit anything. */
  effectiveHours: number;
  /** Capacity = FTE × 38h baseline. 0 for partner / contractor. */
  capacityHours: number;
  utilisationPct: number | null;
  hasForecast: boolean;
  hasBooking: boolean;
};

export type BandwidthRow = {
  personId: string;
  initials: string;
  firstName: string;
  lastName: string;
  band: string;
  employment: 'ft' | 'contractor';
  fte: number | null;
  weeklyCapacityHours: number;
  headshotUrl: string | null;
  cells: BandwidthCell[];
  avgUtilisationPct: number | null;
  hasAnyForecast: boolean;
};

export type BandwidthHeatmap = {
  weeks: Array<{ weekStart: Date; label: string }>;
  rows: BandwidthRow[];
  totals: {
    forecastSubmissionPct: number;
    overbookedCells: number;
    underutilisedCount: number;
    firmAvgUtilisationPct: number | null;
    /** Sum of unallocated forecast hours across every (person × week)
     *  in the window - the headline "how much spare capacity is on
     *  the market" number. */
    unallocatedForecastHours: number;
    /** Sum of allocated-to-project forecast hours across the window.
     *  Combined with unallocated, gives the total forecast commitment. */
    allocatedForecastHours: number;
  };
};

const BASELINE_HOURS_PER_FTE_WEEK = 38;

/**
 * Heatmap roll-up: aggregates per-day AvailabilityForecast rows into
 * weekly totals. Reads timesheet entries for the same horizon so the
 * "booked" overlay stays accurate.
 */
export async function computeBandwidthHeatmap(
  weeksAhead: number = 6,
  reference: Date = new Date(),
): Promise<BandwidthHeatmap> {
  const firstWeek = startOfWeek(reference);
  const weeks = Array.from({ length: weeksAhead }, (_, i) => {
    const s = addDays(firstWeek, i * 7);
    return {
      weekStart: s,
      label: s.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
    };
  });
  const rangeStart = firstWeek;
  const rangeEnd = addDays(firstWeek, weeksAhead * 7);

  const people = await prisma.person.findMany({
    // Inactive = soft-paused; they don't contribute capacity / utilisation
    // until reactivated. Archived (endDate set) is the terminal exit.
    // isStaff narrows the heatmap to the FT/PT employee subset we
    // actually track utilisation for — partners, fellows, contractors
    // are excluded even though they may have an FTE value.
    where: { endDate: null, inactiveAt: null, isStaff: true },
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
  const dailyForecasts = await prisma.availabilityForecast.findMany({
    where: { date: { gte: rangeStart, lt: rangeEnd } },
    select: { personId: true, date: true, hours: true, projectId: true },
  });
  const entries = await prisma.timesheetEntry.findMany({
    where: { date: { gte: rangeStart, lt: rangeEnd } },
    select: { personId: true, date: true, hours: true },
  });

  // Day-of-week lookup for regular schedule fallback.
  function regularHoursFor(p: (typeof people)[number], d: Date): number {
    if (!p.regularDaysEnabled) return 0;
    const dow = d.getUTCDay();
    switch (dow) {
      case 1:
        return p.regularMonHours;
      case 2:
        return p.regularTueHours;
      case 3:
        return p.regularWedHours;
      case 4:
        return p.regularThuHours;
      case 5:
        return p.regularFriHours;
      case 6:
        return p.regularSatHours;
      case 0:
        return p.regularSunHours;
      default:
        return 0;
    }
  }
  // Per-(person, day) override map so we can tell explicit-vs-default.
  // Also captures projectId per cell so the weekly split (allocated
  // vs unallocated) can be computed downstream. Regular-days fallback
  // hours are always treated as unallocated (there's no project
  // context on the regular-days schedule).
  const explicitByPersonDay = new Map<
    string,
    { hours: number; projectId: string | null }
  >();
  for (const f of dailyForecasts) {
    const k = `${f.personId}|${f.date.toISOString().slice(0, 10)}`;
    explicitByPersonDay.set(k, { hours: f.hours, projectId: f.projectId });
  }

  // Aggregate per-day forecasts → weekly totals per (person, weekStart),
  // falling back to the person's regular schedule for days without an
  // explicit row when `regularDaysEnabled` is on. `cellCount` tracks
  // explicit entries only — we don't want defaults to count as "they
  // submitted a forecast".
  const fcKey = (p: string, w: Date) =>
    `${p}|${w.toISOString().slice(0, 10)}`;
  const forecastByKey = new Map<
    string,
    { hours: number; cellCount: number; allocatedHours: number; unallocatedHours: number }
  >();
  // Walk every (person × day) in the horizon so we can apply regular-
  // days fallback uniformly.
  for (const p of people) {
    for (let i = 0; i < weeksAhead * 7; i += 1) {
      const d = addDays(rangeStart, i);
      const iso = d.toISOString().slice(0, 10);
      const explicit = explicitByPersonDay.get(`${p.id}|${iso}`);
      const hours = explicit !== undefined ? explicit.hours : regularHoursFor(p, d);
      if (hours <= 0 && explicit === undefined) continue;
      const ws = startOfWeek(d);
      const k = fcKey(p.id, ws);
      const cur =
        forecastByKey.get(k) ??
        { hours: 0, cellCount: 0, allocatedHours: 0, unallocatedHours: 0 };
      cur.hours += hours;
      // Split allocated vs unallocated:
      //   - Explicit row with projectId → allocated
      //   - Explicit row without projectId, OR regular-days fallback → unallocated
      // Regular-days is treated as unallocated because the schedule
      // has no project context - it's just "I usually work Tue/Wed".
      if (explicit !== undefined && explicit.projectId) {
        cur.allocatedHours += hours;
      } else {
        cur.unallocatedHours += hours;
      }
      // Only mark "has forecast" when the person actually has at least
      // one explicit row OR a non-zero regular schedule.
      if (explicit !== undefined || hours > 0) cur.cellCount += 1;
      forecastByKey.set(k, cur);
    }
  }

  const rows: BandwidthRow[] = people.map((p) => {
    const fte = p.fte !== null ? Number(p.fte) : null;
    // Leadership tier (Partner / MP / Associate Partner) +
    // contractors don't contribute to the pyramid-tracked weekly
    // capacity — their availability is per-project, not a
    // baseline-FTE multiplier.
    const weeklyCapacity =
      p.employment === 'contractor' ||
      p.band === 'Partner' ||
      p.band === 'MP' ||
      p.band === 'Associate_Partner'
        ? 0
        : Math.round((fte ?? 1) * BASELINE_HOURS_PER_FTE_WEEK);

    let pctSum = 0;
    let pctCount = 0;
    let hasAnyForecast = false;

    const cells: BandwidthCell[] = weeks.map((w) => {
      const wEnd = addDays(w.weekStart, 7);
      const fc = forecastByKey.get(fcKey(p.id, w.weekStart));
      const booked = entries
        .filter(
          (e) =>
            e.personId === p.id &&
            e.date.getTime() >= w.weekStart.getTime() &&
            e.date.getTime() < wEnd.getTime(),
        )
        .reduce((s, e) => s + Number(e.hours), 0);
      const forecastHours = fc?.hours ?? null;
      const effective = forecastHours ?? booked;
      if (forecastHours !== null) hasAnyForecast = true;
      const utilisationPct =
        weeklyCapacity > 0 && effective > 0
          ? Math.round((effective / weeklyCapacity) * 100)
          : weeklyCapacity > 0
            ? 0
            : null;
      if (utilisationPct !== null) {
        pctSum += utilisationPct;
        pctCount += 1;
      }
      return {
        weekStart: w.weekStart,
        forecastHours,
        allocatedForecastHours: fc?.allocatedHours ?? 0,
        unallocatedForecastHours: fc?.unallocatedHours ?? 0,
        bookedHours: booked,
        effectiveHours: effective,
        capacityHours: weeklyCapacity,
        utilisationPct,
        hasForecast: forecastHours !== null,
        hasBooking: booked > 0,
      };
    });

    const avgUtilisationPct =
      pctCount > 0 ? Math.round(pctSum / pctCount) : null;

    return {
      personId: p.id,
      initials: p.initials,
      headshotUrl: p.headshotUrl,
      firstName: p.firstName,
      lastName: p.lastName,
      band: p.band,
      employment: p.employment,
      fte,
      weeklyCapacityHours: weeklyCapacity,
      cells,
      avgUtilisationPct,
      hasAnyForecast,
    };
  });

  const peopleWithForecasts = rows.filter((r) => r.hasAnyForecast).length;
  const forecastSubmissionPct =
    rows.length > 0 ? Math.round((peopleWithForecasts / rows.length) * 100) : 0;
  const overbookedCells = rows
    .flatMap((r) => r.cells)
    .filter((c) => c.utilisationPct !== null && c.utilisationPct > 100).length;
  const underutilisedCount = rows.filter(
    (r) => r.weeklyCapacityHours > 0 && (r.avgUtilisationPct ?? 0) < 40,
  ).length;
  const utilSamples = rows
    .map((r) => r.avgUtilisationPct)
    .filter((p): p is number => p !== null);
  const firmAvgUtilisationPct =
    utilSamples.length > 0
      ? Math.round(utilSamples.reduce((s, p) => s + p, 0) / utilSamples.length)
      : null;

  const unallocatedForecastHours = rows
    .flatMap((r) => r.cells)
    .reduce((s, c) => s + c.unallocatedForecastHours, 0);
  const allocatedForecastHours = rows
    .flatMap((r) => r.cells)
    .reduce((s, c) => s + c.allocatedForecastHours, 0);

  return {
    weeks,
    rows,
    totals: {
      forecastSubmissionPct,
      overbookedCells,
      underutilisedCount,
      firmAvgUtilisationPct,
      unallocatedForecastHours,
      allocatedForecastHours,
    },
  };
}

export type AvailabilityDayCell = {
  /** Calendar day this cell represents — UTC Monday of week 0 + N days. */
  dateIso: string;
  /** Existing forecast hours for the day; null when the staff member
   *  hasn't submitted anything for this day. */
  hours: number | null;
  /** Free-text comment; null when not set. */
  notes: string | null;
  /** Project the hours are earmarked to. Null = unallocated (available
   *  bandwidth ready to be staffed). */
  projectId: string | null;
};

/** Read the existing per-day forecast for a person across `weeks` weeks.
 *  When the person has `regularDaysEnabled = true`, days with no stored
 *  AvailabilityForecast row inherit hours from the regular weekly
 *  schedule. The cell's `hours` reflects the inherited value so the
 *  editor renders pre-filled defaults; saving them through the action
 *  materialises them into actual rows. */
export async function loadAvailabilityForPerson(
  personId: string,
  weeks: number = 4,
  reference: Date = new Date(),
): Promise<AvailabilityDayCell[]> {
  const start = startOfWeek(reference);
  const end = addDays(start, weeks * 7);
  const [rows, person] = await Promise.all([
    prisma.availabilityForecast.findMany({
      where: { personId, date: { gte: start, lt: end } },
      select: { date: true, hours: true, notes: true, projectId: true },
    }),
    prisma.person.findUnique({
      where: { id: personId },
      select: {
        regularDaysEnabled: true,
        regularMonHours: true,
        regularTueHours: true,
        regularWedHours: true,
        regularThuHours: true,
        regularFriHours: true,
        regularSatHours: true,
        regularSunHours: true,
      },
    }),
  ]);
  const byDay = new Map(
    rows.map((r) => [
      r.date.toISOString().slice(0, 10),
      { hours: r.hours, notes: r.notes ?? null, projectId: r.projectId ?? null },
    ]),
  );
  // Mon=0..Sun=6 lookup for the regular schedule.
  function regularHoursFor(d: Date): number {
    if (!person?.regularDaysEnabled) return 0;
    const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
    switch (dow) {
      case 1:
        return person.regularMonHours;
      case 2:
        return person.regularTueHours;
      case 3:
        return person.regularWedHours;
      case 4:
        return person.regularThuHours;
      case 5:
        return person.regularFriHours;
      case 6:
        return person.regularSatHours;
      case 0:
        return person.regularSunHours;
      default:
        return 0;
    }
  }
  const result: AvailabilityDayCell[] = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const d = addDays(start, i);
    const iso = d.toISOString().slice(0, 10);
    const stored = byDay.get(iso);
    if (stored) {
      result.push({
        dateIso: iso,
        hours: stored.hours,
        notes: stored.notes,
        projectId: stored.projectId,
      });
    } else {
      const inherited = regularHoursFor(d);
      result.push({
        dateIso: iso,
        hours: person?.regularDaysEnabled ? inherited : null,
        notes: null,
        projectId: null,
      });
    }
  }
  return result;
}

export type AvailabilityUpsertResult =
  | { ok: true; cellsWritten: number }
  | { ok: false; error: string };

/**
 * Bulk upsert per-day cells for one person.
 *   - hours = number → upsert (insert or replace)
 *   - hours = null AND notes empty → delete the row (clears the cell)
 *   - hours = null but notes present → row stays with hours=0 and the comment
 *
 * `notes` is trimmed and capped at 500 chars; empty strings normalise to null.
 */
export async function upsertAvailabilityForPerson(
  personId: string,
  cells: Array<{
    dateIso: string;
    hours: number | null;
    notes?: string | null;
    /** Project the hours are earmarked to; null / undefined = unallocated. */
    projectId?: string | null;
  }>,
): Promise<AvailabilityUpsertResult> {
  if (cells.length === 0) return { ok: true, cellsWritten: 0 };
  let written = 0;
  try {
    for (const c of cells) {
      const date = new Date(`${c.dateIso}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime())) continue;
      const cleanedNotes =
        typeof c.notes === 'string' && c.notes.trim().length > 0
          ? c.notes.trim().slice(0, 500)
          : null;
      const projectId =
        typeof c.projectId === 'string' && c.projectId.length > 0
          ? c.projectId
          : null;
      if (c.hours === null && cleanedNotes === null) {
        await prisma.availabilityForecast.deleteMany({
          where: { personId, date },
        });
        continue;
      }
      const hours = Math.max(0, Math.min(24, Math.round(c.hours ?? 0)));
      await prisma.availabilityForecast.upsert({
        where: { personId_date: { personId, date } },
        update: { hours, notes: cleanedNotes, projectId },
        create: { personId, date, hours, notes: cleanedNotes, projectId },
      });
      written += 1;
    }
  } catch (err) {
    console.error('[availability.upsert] failed:', err);
    return { ok: false, error: 'Save failed — try again.' };
  }
  return { ok: true, cellsWritten: written };
}
