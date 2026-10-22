import { prisma } from '@/server/db';
import { addDays, startOfWeek, todayInFirmTz } from '@/lib/week';

/**
 * Band-level supply: how many hours of each delivery band are going
 * spare, per day and per week (per TT, 2026-10-23 — "we need to know
 * what the total 'analyst hours' available each day and week").
 *
 * `computeBandwidthHeatmap` answers "is this person full?" at person ×
 * week. This answers the opposite question at band × day: "how much
 * analyst time can I sell on Thursday?" Same underlying
 * `AvailabilityForecast` rows and the same regular-days fallback, so
 * the two surfaces never disagree about a given day.
 *
 * Three states per person-day, kept apart on purpose:
 *   - allocated     — explicit forecast row tagged to a project
 *   - declared free — explicit forecast row with no project
 *   - assumed free  — no row, but the person has a regular-days
 *                     schedule saying they normally work that day
 *
 * Assumed hours are real planning signal but they are an inference, so
 * they are never folded into the declared number silently. A person
 * with neither a row nor a schedule contributes nothing and is counted
 * as a non-submitter instead — absence of a forecast is unknown
 * capacity, not free capacity, and reading it as free is how a bench
 * gets oversold.
 */

/** Delivery bands this roll-up covers, in pyramid order. */
export const SUPPLY_BANDS = ['Analyst', 'Consultant', 'Expert'] as const;
export type SupplyBand = (typeof SUPPLY_BANDS)[number];

export type SupplyTotals = {
  allocatedHours: number;
  declaredFreeHours: number;
  assumedFreeHours: number;
  /** declaredFree + assumedFree — the headline "available" figure. */
  availableHours: number;
  /** Distinct people contributing any hours (allocated or free). */
  peopleWithSignal: number;
};

export type BandSupplyRow = {
  band: SupplyBand;
  /** Active FT staff in this band, whether or not they forecast. */
  headcount: number;
  /** People in this band with no forecast row and no regular-days
   *  schedule anywhere in the horizon. The supply figure says nothing
   *  about them. */
  silentCount: number;
  /** One per day in the horizon, in order. */
  days: SupplyTotals[];
  /** One per week in the horizon, in order. */
  weeks: SupplyTotals[];
};

export type BandSupplyReport = {
  days: Array<{ iso: string; label: string; isWeekend: boolean; isToday: boolean }>;
  weeks: Array<{ weekStartIso: string; label: string }>;
  rows: BandSupplyRow[];
  /** Firm-level roll-up across the covered bands. */
  totals: { days: SupplyTotals[]; weeks: SupplyTotals[] };
};

const emptyTotals = (): SupplyTotals => ({
  allocatedHours: 0,
  declaredFreeHours: 0,
  assumedFreeHours: 0,
  availableHours: 0,
  peopleWithSignal: 0,
});

type RegularSchedule = {
  regularDaysEnabled: boolean;
  regularMonHours: number;
  regularTueHours: number;
  regularWedHours: number;
  regularThuHours: number;
  regularFriHours: number;
  regularSatHours: number;
  regularSunHours: number;
};

/** The person's standing schedule for a given weekday, or 0 when they
 *  haven't declared one. Mirrors the heatmap's fallback exactly. */
export function regularHoursForDay(p: RegularSchedule, d: Date): number {
  if (!p.regularDaysEnabled) return 0;
  switch (d.getUTCDay()) {
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

/**
 * Fold one person-day into a totals bucket. Exported for the unit test
 * and reused for both the daily and the weekly bucket so the two can
 * never drift.
 */
export function addPersonDay(
  into: SupplyTotals,
  cell: { hours: number; allocated: boolean; assumed: boolean },
): void {
  if (cell.hours <= 0) return;
  if (cell.allocated) {
    into.allocatedHours += cell.hours;
  } else if (cell.assumed) {
    into.assumedFreeHours += cell.hours;
    into.availableHours += cell.hours;
  } else {
    into.declaredFreeHours += cell.hours;
    into.availableHours += cell.hours;
  }
}

export async function computeBandSupply(
  weeksAhead: number = 6,
  reference: Date = todayInFirmTz(),
): Promise<BandSupplyReport> {
  const firstWeek = startOfWeek(reference);
  const dayCount = weeksAhead * 7;
  const rangeEnd = addDays(firstWeek, dayCount);
  const todayIso = todayInFirmTz().toISOString().slice(0, 10);

  const dayDates = Array.from({ length: dayCount }, (_, i) => addDays(firstWeek, i));
  const days = dayDates.map((d) => ({
    iso: d.toISOString().slice(0, 10),
    label: d.toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
    isWeekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
    isToday: d.toISOString().slice(0, 10) === todayIso,
  }));
  const weeks = Array.from({ length: weeksAhead }, (_, i) => {
    const ws = addDays(firstWeek, i * 7);
    return {
      weekStartIso: ws.toISOString().slice(0, 10),
      label: ws.toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }),
    };
  });

  // Same population the bandwidth heatmap tracks utilisation for, cut
  // to the delivery bands. Contractors are excluded on the heatmap's
  // basis: their capacity is allocation-driven, not an FTE baseline,
  // so folding them into a band supply figure would overstate what the
  // firm can actually staff from salaried people.
  const people = await prisma.person.findMany({
    where: {
      endDate: null,
      inactiveAt: null,
      isStaff: true,
      employment: 'ft',
      band: { in: [...SUPPLY_BANDS] },
    },
    select: {
      id: true,
      band: true,
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
  const forecasts = await prisma.availabilityForecast.findMany({
    where: {
      date: { gte: firstWeek, lt: rangeEnd },
      personId: { in: people.map((p) => p.id) },
    },
    select: { personId: true, date: true, hours: true, projectId: true },
  });
  const byPersonDay = new Map<string, { hours: number; projectId: string | null }>();
  for (const f of forecasts) {
    byPersonDay.set(`${f.personId}|${f.date.toISOString().slice(0, 10)}`, {
      hours: f.hours,
      projectId: f.projectId,
    });
  }

  const rows: BandSupplyRow[] = SUPPLY_BANDS.map((band) => {
    const cohort = people.filter((p) => p.band === band);
    const dayTotals = dayDates.map(() => emptyTotals());
    const weekTotals = weeks.map(() => emptyTotals());
    let silentCount = 0;

    for (const p of cohort) {
      let sawAnything = false;
      // Distinct-people counts need a per-week set, since a person
      // contributing on Tue and Thu is still one person that week.
      for (let i = 0; i < dayCount; i += 1) {
        const d = dayDates[i]!;
        const explicit = byPersonDay.get(`${p.id}|${days[i]!.iso}`);
        const hours = explicit !== undefined ? explicit.hours : regularHoursForDay(p, d);
        if (hours <= 0) continue;
        sawAnything = true;
        const cell = {
          hours,
          allocated: explicit !== undefined && explicit.projectId !== null,
          assumed: explicit === undefined,
        };
        addPersonDay(dayTotals[i]!, cell);
        dayTotals[i]!.peopleWithSignal += 1;
        addPersonDay(weekTotals[Math.floor(i / 7)]!, cell);
      }
      // Week-level headcount: count the person once per week they
      // contribute to, not once per day.
      for (let w = 0; w < weeks.length; w += 1) {
        const contributed = dayDates
          .slice(w * 7, w * 7 + 7)
          .some((d, j) => {
            const iso = days[w * 7 + j]!.iso;
            const explicit = byPersonDay.get(`${p.id}|${iso}`);
            const h = explicit !== undefined ? explicit.hours : regularHoursForDay(p, d);
            return h > 0;
          });
        if (contributed) weekTotals[w]!.peopleWithSignal += 1;
      }
      if (!sawAnything) silentCount += 1;
    }

    return {
      band,
      headcount: cohort.length,
      silentCount,
      days: dayTotals,
      weeks: weekTotals,
    };
  });

  const sumInto = (buckets: SupplyTotals[][]): SupplyTotals[] =>
    buckets[0]!.map((_, i) => {
      const out = emptyTotals();
      for (const b of buckets) {
        out.allocatedHours += b[i]!.allocatedHours;
        out.declaredFreeHours += b[i]!.declaredFreeHours;
        out.assumedFreeHours += b[i]!.assumedFreeHours;
        out.availableHours += b[i]!.availableHours;
        out.peopleWithSignal += b[i]!.peopleWithSignal;
      }
      return out;
    });

  return {
    days,
    weeks,
    rows,
    totals: {
      days: sumInto(rows.map((r) => r.days)),
      weeks: sumInto(rows.map((r) => r.weeks)),
    },
  };
}
