import { prisma } from '@/server/db';

export type UtilisationRow = {
  personId: string;
  initials: string;
  firstName: string;
  lastName: string;
  band: string;
  level: string;
  employment: string;
  fte: number;
  targetHours: number; // FTE × WORKING_HOURS_PER_MONTH
  loggedHours: number; // approved + billed
  billedHours: number; // billedInvoiceId not null
  utilisationPct: number | null; // loggedHours / targetHours × 100
  active: boolean;
  topProjects: Array<{ code: string; name: string; hours: number }>;
};

export type FirmUtilisation = {
  month: string; // YYYY-MM of month viewed
  monthStart: Date;
  monthEnd: Date;
  rows: UtilisationRow[];
  totals: {
    activeHeadcount: number;
    targetHours: number;
    loggedHours: number;
    billedHours: number;
    utilisationPct: number | null;
    billableRatePct: number | null; // billed / logged
  };
};

// Foundry's assumed full-time baseline: ~4 weeks × 40h = 160h/month. Over-
// simplification but consistent across people. Actual working-days-per-month
// calculation is phase-2 once we track public holidays + leave.
const WORKING_HOURS_PER_MONTH = 160;

function ymToRange(month: string): { start: Date; end: Date } {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Invalid month: ${month}`);
  const year = Number(m[1]);
  const mo = Number(m[2]);
  const start = new Date(Date.UTC(year, mo - 1, 1));
  const end = new Date(Date.UTC(year, mo, 1));
  return { start, end };
}

export function currentMonthYm(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Firm-wide utilisation for the given month (YYYY-MM). Includes people who
 * were active for any part of the month — their target is scaled linearly
 * when they started/ended mid-month to avoid punishing new joiners.
 */
export async function computeFirmUtilisation(
  month: string = currentMonthYm(),
): Promise<FirmUtilisation> {
  const { start, end } = ymToRange(month);
  const monthDays =
    (end.getTime() - start.getTime()) / (24 * 3600 * 1000);

  const [people, entries] = await Promise.all([
    prisma.person.findMany({
      where: {
        startDate: { lt: end },
        OR: [{ endDate: null }, { endDate: { gt: start } }],
      },
      orderBy: [{ endDate: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        initials: true,
        firstName: true,
        lastName: true,
        band: true,
        level: true,
        employment: true,
        fte: true,
        startDate: true,
        endDate: true,
      },
    }),
    prisma.timesheetEntry.findMany({
      where: {
        date: { gte: start, lt: end },
        status: { in: ['approved', 'billed'] },
      },
      select: {
        personId: true,
        projectId: true,
        hours: true,
        billedInvoiceId: true,
      },
    }),
  ]);

  if (people.length === 0) {
    return {
      month,
      monthStart: start,
      monthEnd: end,
      rows: [],
      totals: {
        activeHeadcount: 0,
        targetHours: 0,
        loggedHours: 0,
        billedHours: 0,
        utilisationPct: null,
        billableRatePct: null,
      },
    };
  }

  // Fetch the project names we'll need for topProjects breakdown.
  const projectIds = [...new Set(entries.map((e) => e.projectId))];
  const projects =
    projectIds.length > 0
      ? await prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // Bucket hours: personId → projectId → hours + billed.
  const perPerson = new Map<
    string,
    {
      loggedHours: number;
      billedHours: number;
      byProject: Map<string, { code: string; name: string; hours: number }>;
    }
  >();
  for (const e of entries) {
    const hours = Number(e.hours);
    const p =
      perPerson.get(e.personId) ??
      {
        loggedHours: 0,
        billedHours: 0,
        byProject: new Map<string, { code: string; name: string; hours: number }>(),
      };
    p.loggedHours += hours;
    if (e.billedInvoiceId) p.billedHours += hours;
    const proj = projectById.get(e.projectId);
    if (proj) {
      const entry =
        p.byProject.get(proj.id) ??
        ({ code: proj.code, name: proj.name, hours: 0 } as {
          code: string;
          name: string;
          hours: number;
        });
      entry.hours += hours;
      p.byProject.set(proj.id, entry);
    }
    perPerson.set(e.personId, p);
  }

  const rows: UtilisationRow[] = people.map((person) => {
    const fte = Number(person.fte);
    // Scale the monthly target by the fraction of the month they were employed.
    const effStart = person.startDate > start ? person.startDate : start;
    const effEnd = person.endDate && person.endDate < end ? person.endDate : end;
    const daysEmployed = Math.max(
      0,
      (effEnd.getTime() - effStart.getTime()) / (24 * 3600 * 1000),
    );
    const fraction = monthDays > 0 ? daysEmployed / monthDays : 0;
    const targetHours = Math.round(WORKING_HOURS_PER_MONTH * fte * fraction * 10) / 10;

    const stats = perPerson.get(person.id);
    const loggedHours = stats?.loggedHours ?? 0;
    const billedHours = stats?.billedHours ?? 0;
    const topProjects = stats
      ? [...stats.byProject.values()].sort((a, b) => b.hours - a.hours).slice(0, 4)
      : [];
    const utilisationPct =
      targetHours > 0 ? Math.round((loggedHours / targetHours) * 100) : null;

    return {
      personId: person.id,
      initials: person.initials,
      firstName: person.firstName,
      lastName: person.lastName,
      band: person.band,
      level: person.level,
      employment: person.employment,
      fte,
      targetHours,
      loggedHours,
      billedHours,
      utilisationPct,
      active: person.endDate === null || person.endDate >= new Date(),
      topProjects,
    };
  });

  // Sort: highest utilisation first, ties break on logged hours desc.
  rows.sort((a, b) => {
    const ua = a.utilisationPct ?? -1;
    const ub = b.utilisationPct ?? -1;
    if (ua !== ub) return ub - ua;
    return b.loggedHours - a.loggedHours;
  });

  const totals = rows.reduce(
    (acc, r) => ({
      activeHeadcount: acc.activeHeadcount + (r.active ? 1 : 0),
      targetHours: acc.targetHours + r.targetHours,
      loggedHours: acc.loggedHours + r.loggedHours,
      billedHours: acc.billedHours + r.billedHours,
    }),
    { activeHeadcount: 0, targetHours: 0, loggedHours: 0, billedHours: 0 },
  );

  const firmUtilisation =
    totals.targetHours > 0
      ? Math.round((totals.loggedHours / totals.targetHours) * 100)
      : null;
  const billableRate =
    totals.loggedHours > 0
      ? Math.round((totals.billedHours / totals.loggedHours) * 100)
      : null;

  return {
    month,
    monthStart: start,
    monthEnd: end,
    rows,
    totals: {
      ...totals,
      utilisationPct: firmUtilisation,
      billableRatePct: billableRate,
    },
  };
}

/**
 * Returns the last N months of YYYY-MM strings, newest first, for the picker.
 */
export function monthOptions(n = 12): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    );
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}
