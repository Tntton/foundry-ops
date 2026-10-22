import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TASK-521 — how many analyst hours can the firm sell on a given day.
 *
 * The load-bearing call is what counts as "available". An explicit
 * forecast row with no project is a person saying they are free. A
 * regular-days schedule with no row is an inference from their normal
 * week. No row and no schedule is unknown, and reading unknown as free
 * is how a bench gets oversold — so those people are counted and
 * surfaced instead of quietly inflating the number.
 */

const db = vi.hoisted(() => ({
  person: { findMany: vi.fn() },
  availabilityForecast: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

const { computeBandSupply, regularHoursForDay, addPersonDay, SUPPLY_BANDS } =
  await import('@/server/band-supply');

// Monday 26 Oct 2026 is the reference week throughout.
const MON = new Date('2026-10-26T00:00:00.000Z');
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const noSchedule = {
  regularDaysEnabled: false,
  regularMonHours: 0,
  regularTueHours: 0,
  regularWedHours: 0,
  regularThuHours: 0,
  regularFriHours: 0,
  regularSatHours: 0,
  regularSunHours: 0,
};
const fullTimeSchedule = {
  regularDaysEnabled: true,
  regularMonHours: 8,
  regularTueHours: 8,
  regularWedHours: 8,
  regularThuHours: 8,
  regularFriHours: 6,
  regularSatHours: 0,
  regularSunHours: 0,
};

const person = (
  id: string,
  band: string,
  schedule: typeof noSchedule = noSchedule,
) => ({ id, band, ...schedule });

const forecast = (
  personId: string,
  iso: string,
  hours: number,
  projectId: string | null = null,
) => ({ personId, date: d(iso), hours, projectId });

beforeEach(() => {
  db.person.findMany.mockReset();
  db.availabilityForecast.findMany.mockReset();
});

describe('regularHoursForDay', () => {
  it('reads the weekday off the standing schedule', () => {
    expect(regularHoursForDay(fullTimeSchedule, d('2026-10-26'))).toBe(8); // Mon
    expect(regularHoursForDay(fullTimeSchedule, d('2026-10-30'))).toBe(6); // Fri
    expect(regularHoursForDay(fullTimeSchedule, d('2026-10-31'))).toBe(0); // Sat
  });

  it('returns nothing when the person has not declared one', () => {
    expect(regularHoursForDay(noSchedule, d('2026-10-26'))).toBe(0);
    expect(
      regularHoursForDay({ ...fullTimeSchedule, regularDaysEnabled: false }, d('2026-10-26')),
    ).toBe(0);
  });
});

describe('addPersonDay', () => {
  it('keeps declared, assumed and allocated hours apart', () => {
    const t = {
      allocatedHours: 0,
      declaredFreeHours: 0,
      assumedFreeHours: 0,
      availableHours: 0,
      peopleWithSignal: 0,
    };
    addPersonDay(t, { hours: 8, allocated: true, assumed: false });
    addPersonDay(t, { hours: 5, allocated: false, assumed: false });
    addPersonDay(t, { hours: 3, allocated: false, assumed: true });
    expect(t.allocatedHours).toBe(8);
    expect(t.declaredFreeHours).toBe(5);
    expect(t.assumedFreeHours).toBe(3);
    // Available is the two free kinds; allocated hours are committed.
    expect(t.availableHours).toBe(8);
  });

  it('ignores a zero or negative day', () => {
    const t = {
      allocatedHours: 0,
      declaredFreeHours: 0,
      assumedFreeHours: 0,
      availableHours: 0,
      peopleWithSignal: 0,
    };
    addPersonDay(t, { hours: 0, allocated: false, assumed: false });
    addPersonDay(t, { hours: -4, allocated: false, assumed: false });
    expect(t.availableHours).toBe(0);
  });
});

describe('computeBandSupply', () => {
  it('splits a day into allocated and declared-free by band', async () => {
    db.person.findMany.mockResolvedValue([
      person('a1', 'Analyst'),
      person('a2', 'Analyst'),
      person('c1', 'Consultant'),
    ]);
    db.availabilityForecast.findMany.mockResolvedValue([
      forecast('a1', '2026-10-26', 8, 'proj-1'), // committed
      forecast('a2', '2026-10-26', 6, null), // free
      forecast('c1', '2026-10-26', 4, null), // free, other band
    ]);

    const r = await computeBandSupply(1, MON);
    const analyst = r.rows.find((x) => x.band === 'Analyst')!;
    expect(analyst.days[0]!.allocatedHours).toBe(8);
    expect(analyst.days[0]!.declaredFreeHours).toBe(6);
    expect(analyst.days[0]!.availableHours).toBe(6);
    expect(analyst.days[0]!.peopleWithSignal).toBe(2);

    const consultant = r.rows.find((x) => x.band === 'Consultant')!;
    expect(consultant.days[0]!.availableHours).toBe(4);

    // Firm roll-up sums the bands.
    expect(r.totals.days[0]!.availableHours).toBe(10);
    expect(r.totals.days[0]!.allocatedHours).toBe(8);
  });

  it('rolls days up into the matching week', async () => {
    db.person.findMany.mockResolvedValue([person('a1', 'Analyst')]);
    db.availabilityForecast.findMany.mockResolvedValue([
      forecast('a1', '2026-10-26', 8),
      forecast('a1', '2026-10-27', 8),
      forecast('a1', '2026-10-28', 4, 'proj-1'),
      // Second week of the horizon.
      forecast('a1', '2026-11-02', 7),
    ]);

    const r = await computeBandSupply(2, MON);
    const analyst = r.rows[0]!;
    expect(analyst.weeks[0]!.availableHours).toBe(16);
    expect(analyst.weeks[0]!.allocatedHours).toBe(4);
    expect(analyst.weeks[1]!.availableHours).toBe(7);
    // One person contributing across three days is one person that week.
    expect(analyst.weeks[0]!.peopleWithSignal).toBe(1);
  });

  it('falls back to the standing schedule and marks those hours assumed', async () => {
    db.person.findMany.mockResolvedValue([person('a1', 'Analyst', fullTimeSchedule)]);
    db.availabilityForecast.findMany.mockResolvedValue([]);

    const r = await computeBandSupply(1, MON);
    const analyst = r.rows[0]!;
    expect(analyst.days[0]!.assumedFreeHours).toBe(8); // Mon
    expect(analyst.days[0]!.declaredFreeHours).toBe(0);
    expect(analyst.days[0]!.availableHours).toBe(8);
    expect(analyst.days[4]!.assumedFreeHours).toBe(6); // Fri
    expect(analyst.days[5]!.availableHours).toBe(0); // Sat
    expect(analyst.weeks[0]!.assumedFreeHours).toBe(38);
    expect(analyst.silentCount).toBe(0);
  });

  it('lets an explicit row override the standing schedule for that day', async () => {
    db.person.findMany.mockResolvedValue([person('a1', 'Analyst', fullTimeSchedule)]);
    db.availabilityForecast.findMany.mockResolvedValue([
      forecast('a1', '2026-10-26', 0), // explicitly taking Monday off
      forecast('a1', '2026-10-27', 8, 'proj-1'), // Tuesday is committed
    ]);

    const r = await computeBandSupply(1, MON);
    const analyst = r.rows[0]!;
    expect(analyst.days[0]!.availableHours).toBe(0);
    expect(analyst.days[0]!.assumedFreeHours).toBe(0);
    expect(analyst.days[1]!.allocatedHours).toBe(8);
    expect(analyst.days[1]!.availableHours).toBe(0);
    // Wed–Fri still come from the schedule: 8 + 8 + 6.
    expect(analyst.weeks[0]!.assumedFreeHours).toBe(22);
  });

  it('counts people with neither a row nor a schedule instead of calling them free', async () => {
    db.person.findMany.mockResolvedValue([
      person('a1', 'Analyst'), // silent
      person('a2', 'Analyst'), // silent
      person('a3', 'Analyst', fullTimeSchedule),
    ]);
    db.availabilityForecast.findMany.mockResolvedValue([]);

    const r = await computeBandSupply(1, MON);
    const analyst = r.rows[0]!;
    expect(analyst.headcount).toBe(3);
    expect(analyst.silentCount).toBe(2);
    // Only the one with a schedule contributes.
    expect(analyst.days[0]!.availableHours).toBe(8);
    expect(analyst.days[0]!.peopleWithSignal).toBe(1);
  });

  it('asks the DB only for the delivery bands and salaried staff', async () => {
    db.person.findMany.mockResolvedValue([]);
    db.availabilityForecast.findMany.mockResolvedValue([]);
    await computeBandSupply(1, MON);
    const where = db.person.findMany.mock.calls[0]![0].where;
    expect(where.band.in).toEqual([...SUPPLY_BANDS]);
    expect(where.employment).toBe('ft');
    expect(where.isStaff).toBe(true);
    expect(where.endDate).toBe(null);
    expect(where.inactiveAt).toBe(null);
  });

  it('returns an empty band row rather than dropping the band', async () => {
    db.person.findMany.mockResolvedValue([person('c1', 'Consultant')]);
    db.availabilityForecast.findMany.mockResolvedValue([]);
    const r = await computeBandSupply(1, MON);
    expect(r.rows.map((x) => x.band)).toEqual([...SUPPLY_BANDS]);
    const analyst = r.rows.find((x) => x.band === 'Analyst')!;
    expect(analyst.headcount).toBe(0);
    expect(analyst.days.every((x) => x.availableHours === 0)).toBe(true);
  });

  it('labels the horizon day by day and week by week', async () => {
    db.person.findMany.mockResolvedValue([]);
    db.availabilityForecast.findMany.mockResolvedValue([]);
    const r = await computeBandSupply(2, MON);
    expect(r.days).toHaveLength(14);
    expect(r.weeks).toHaveLength(2);
    expect(r.days[0]!.iso).toBe('2026-10-26');
    expect(r.days[5]!.isWeekend).toBe(true); // Sat
    expect(r.days[6]!.isWeekend).toBe(true); // Sun
    expect(r.days[0]!.isWeekend).toBe(false);
    expect(r.weeks[1]!.weekStartIso).toBe('2026-11-02');
  });
});
