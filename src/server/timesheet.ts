import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';
import { addDays } from '@/lib/week';

export type TimesheetCell = {
  date: Date;
  hours: number;
};

export type TimesheetRow = {
  projectId: string;
  projectCode: string;
  projectName: string;
  /** Project stage at fetch time — used by the grid to colour-code the sub-tag (delivery / kickoff / closing / archived). */
  projectStage: 'kickoff' | 'delivery' | 'closing' | 'archived' | 'standing' | 'benched';
  description: string;
  status: 'draft' | 'submitted' | 'approved' | 'billed' | 'mixed';
  cells: TimesheetCell[];
};

export async function getMonthForPerson(
  personId: string,
  blockStart: Date,
): Promise<TimesheetRow[]> {
  return getRangeForPerson(personId, blockStart, 28);
}

export async function getWeekForPerson(
  personId: string,
  weekStart: Date,
): Promise<TimesheetRow[]> {
  return getRangeForPerson(personId, weekStart, 7);
}

async function getRangeForPerson(
  personId: string,
  rangeStart: Date,
  days: number,
): Promise<TimesheetRow[]> {
  const rangeEnd = addDays(rangeStart, days);

  const [entries, assignments] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: {
        personId,
        date: { gte: rangeStart, lt: rangeEnd },
      },
      include: {
        project: { select: { id: true, code: true, name: true, stage: true } },
      },
    }),
    prisma.projectTeam.findMany({
      where: {
        personId,
        project: { stage: { not: 'archived' } },
      },
      include: {
        project: { select: { id: true, code: true, name: true, stage: true } },
      },
    }),
  ]);

  type ProjectMini = {
    id: string;
    code: string;
    name: string;
    stage: 'kickoff' | 'delivery' | 'closing' | 'archived' | 'standing' | 'benched';
  };
  const projectsMap = new Map<string, ProjectMini>();
  for (const a of assignments) projectsMap.set(a.project.id, a.project);
  for (const e of entries) projectsMap.set(e.project.id, e.project);

  return Array.from(projectsMap.values())
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => {
      const projectEntries = entries.filter((e) => e.projectId === p.id);
      const cells: TimesheetCell[] = Array.from({ length: days }, (_, i) => {
        const date = addDays(rangeStart, i);
        const entry = projectEntries.find(
          (e) =>
            e.date.getUTCFullYear() === date.getUTCFullYear() &&
            e.date.getUTCMonth() === date.getUTCMonth() &&
            e.date.getUTCDate() === date.getUTCDate(),
        );
        return {
          date,
          hours: entry ? Number(entry.hours) : 0,
        };
      });
      const description =
        projectEntries.find((e) => e.description)?.description ?? '';
      const statuses = new Set(projectEntries.map((e) => e.status));
      const status: TimesheetRow['status'] =
        statuses.size === 0
          ? 'draft'
          : statuses.size > 1
            ? 'mixed'
            : (projectEntries[0]?.status ?? 'draft');

      return {
        projectId: p.id,
        projectCode: p.code,
        projectName: p.name,
        projectStage: p.stage,
        description,
        status,
        cells,
      };
    });
}

export async function listPendingTimesheetEntriesForApprover(session: Session) {
  const roles = session.person.roles;
  const canSeeAll = roles.includes('super_admin') || roles.includes('admin');
  const where = canSeeAll
    ? { status: 'submitted' as const }
    : {
        status: 'submitted' as const,
        project: { managerId: session.person.id },
      };
  const entries = await prisma.timesheetEntry.findMany({
    where,
    orderBy: [{ date: 'asc' }, { personId: 'asc' }],
    include: {
      person: { select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true } },
      project: { select: { id: true, code: true, name: true, managerId: true } },
    },
  });
  return entries;
}

/**
 * History view for the approval queue: entries this approver decided
 * (approved / rolled back) in the last `days` days. Lets the approver see
 * what they actioned — answers "where do approvals go after I click approve?".
 */
export async function listRecentDecidedEntriesForApprover(
  session: Session,
  days: number = 30,
) {
  const since = addDays(new Date(), -days);
  const roles = session.person.roles;
  const canSeeAll = roles.includes('super_admin') || roles.includes('admin');
  const where = canSeeAll
    ? {
        approvedById: { not: null },
        approvedAt: { gte: since },
      }
    : {
        approvedById: session.person.id,
        approvedAt: { gte: since },
      };
  const entries = await prisma.timesheetEntry.findMany({
    where,
    orderBy: [{ approvedAt: 'desc' }],
    take: 200,
    include: {
      person: { select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true } },
      project: { select: { id: true, code: true, name: true } },
    },
  });
  return entries;
}

export type ProjectTimesheetEntry = {
  id: string;
  date: Date;
  hours: number;
  description: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'billed';
  approvedAt: Date | null;
  billedInvoiceId: string | null;
  costCents: number; // hours × person.rate
  person: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  };
};

export async function listProjectTimesheetEntries(
  projectId: string,
  opts: { from?: Date; to?: Date } = {},
): Promise<ProjectTimesheetEntry[]> {
  const where: Record<string, unknown> = { projectId };
  if (opts.from || opts.to) {
    const range: { gte?: Date; lt?: Date } = {};
    if (opts.from) range.gte = opts.from;
    if (opts.to) range.lt = opts.to;
    where['date'] = range;
  }
  const entries = await prisma.timesheetEntry.findMany({
    where,
    orderBy: [{ date: 'desc' }, { personId: 'asc' }],
    include: {
      person: {
        select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true, rate: true },
      },
    },
  });
  return entries.map((e) => ({
    id: e.id,
    date: e.date,
    hours: Number(e.hours),
    description: e.description,
    status: e.status,
    approvedAt: e.approvedAt,
    billedInvoiceId: e.billedInvoiceId,
    costCents: Math.round(Number(e.hours) * (e.person.rate ?? 0)),
    person: {
      id: e.person.id,
      initials: e.person.initials,
      firstName: e.person.firstName,
      lastName: e.person.lastName,
      headshotUrl: e.person.headshotUrl,
    },
  }));
}

export type PersonTimesheetEntry = {
  id: string;
  date: Date;
  hours: number;
  description: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'billed';
  approvedAt: Date | null;
  billedInvoiceId: string | null;
  project: { id: string; code: string; name: string };
};

export async function listPersonTimesheetEntries(
  personId: string,
  opts: { from?: Date; to?: Date; status?: 'draft' | 'submitted' | 'approved' | 'billed' } = {},
): Promise<PersonTimesheetEntry[]> {
  const where: Record<string, unknown> = { personId };
  if (opts.from || opts.to) {
    const range: { gte?: Date; lt?: Date } = {};
    if (opts.from) range.gte = opts.from;
    if (opts.to) range.lt = opts.to;
    where['date'] = range;
  }
  if (opts.status) where['status'] = opts.status;
  const entries = await prisma.timesheetEntry.findMany({
    where,
    orderBy: [{ date: 'desc' }],
    include: {
      project: { select: { id: true, code: true, name: true } },
    },
  });
  return entries.map((e) => ({
    id: e.id,
    date: e.date,
    hours: Number(e.hours),
    description: e.description,
    status: e.status,
    approvedAt: e.approvedAt,
    billedInvoiceId: e.billedInvoiceId,
    project: e.project,
  }));
}

/**
 * Approved + unbilled entries for a contractor — the basis for a draft Bill.
 * Returns per-project sub-totals so we can surface a cleanly-grouped review
 * on the contractor's profile.
 */
export type ContractorBillableGroup = {
  projectId: string;
  projectCode: string;
  projectName: string;
  hours: number;
  costCents: number; // at the contractor's cost rate
  billCents: number; // at billRate if set, else cost rate
  entryIds: string[];
};

export async function listContractorBillableEntries(
  personId: string,
): Promise<{ groups: ContractorBillableGroup[]; rate: number; billRate: number | null }> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { rate: true, billRate: true, employment: true },
  });
  if (!person) return { groups: [], rate: 0, billRate: null };

  const entries = await prisma.timesheetEntry.findMany({
    where: { personId, status: 'approved', billedInvoiceId: null },
    include: { project: { select: { id: true, code: true, name: true } } },
    orderBy: [{ date: 'asc' }],
  });

  const map = new Map<string, ContractorBillableGroup>();
  for (const e of entries) {
    const cur =
      map.get(e.projectId) ??
      ({
        projectId: e.projectId,
        projectCode: e.project.code,
        projectName: e.project.name,
        hours: 0,
        costCents: 0,
        billCents: 0,
        entryIds: [] as string[],
      } satisfies ContractorBillableGroup);
    const h = Number(e.hours);
    cur.hours += h;
    cur.costCents += Math.round(h * (person.rate ?? 0));
    cur.billCents += Math.round(h * (person.billRate ?? person.rate ?? 0));
    cur.entryIds.push(e.id);
    map.set(e.projectId, cur);
  }
  return {
    groups: Array.from(map.values()).sort((a, b) => a.projectCode.localeCompare(b.projectCode)),
    rate: person.rate ?? 0,
    billRate: person.billRate ?? null,
  };
}

// ─── Hourly utilisation, approval history, availability forecast ─────────

export type HourlyUtilisationCategory =
  | 'delivery'
  | 'kickoff'
  | 'closing'
  | 'archived'
  | 'standing'
  | 'benched';

export type HourlyUtilisation = {
  totalHours: number;
  byCategory: Array<{ category: HourlyUtilisationCategory; label: string; hours: number }>;
  byProject: Array<{ projectId: string; projectCode: string; projectName: string; hours: number }>;
};

const STAGE_LABEL_FOR_TS: Record<HourlyUtilisationCategory, string> = {
  kickoff: 'Kickoff / setup',
  delivery: 'Delivery',
  closing: 'Closing',
  archived: 'Firm / archived',
  standing: 'Internal · standing',
  benched: 'Internal · benched',
};

/**
 * Hours-only utilisation for the timesheet sidebar. No targets, no FTE
 * assumptions — pure logged-hours roll-up split by project stage so the
 * person can see at-a-glance where the week went.
 */
export async function getHourlyUtilisationForWeek(
  personId: string,
  weekStart: Date,
): Promise<HourlyUtilisation> {
  const weekEnd = addDays(weekStart, 7);
  const entries = await prisma.timesheetEntry.findMany({
    where: { personId, date: { gte: weekStart, lt: weekEnd } },
    include: { project: { select: { id: true, code: true, name: true, stage: true } } },
  });

  const catMap = new Map<HourlyUtilisationCategory, number>();
  const projMap = new Map<string, { projectId: string; projectCode: string; projectName: string; hours: number }>();
  let total = 0;
  for (const e of entries) {
    const h = Number(e.hours);
    total += h;
    const stage = e.project.stage as HourlyUtilisationCategory;
    catMap.set(stage, (catMap.get(stage) ?? 0) + h);
    const cur = projMap.get(e.projectId) ?? {
      projectId: e.projectId,
      projectCode: e.project.code,
      projectName: e.project.name,
      hours: 0,
    };
    cur.hours += h;
    projMap.set(e.projectId, cur);
  }
  const order: HourlyUtilisationCategory[] = ['delivery', 'kickoff', 'closing', 'archived'];
  return {
    totalHours: total,
    byCategory: order
      .map((c) => ({ category: c, label: STAGE_LABEL_FOR_TS[c], hours: catMap.get(c) ?? 0 }))
      .filter((r) => r.hours > 0),
    byProject: Array.from(projMap.values()).sort((a, b) => b.hours - a.hours),
  };
}

export type ApprovalHistoryRow = {
  weekStart: Date;
  status: 'draft' | 'submitted' | 'approved' | 'billed' | 'mixed' | 'flag_resolved';
  approverInitials: string | null;
  totalHours: number;
  isCurrentWeek: boolean;
};

/**
 * Per-week status summary for the last `weeksBack` weeks. Combines submission
 * state with whether the week was rejected-and-resubmitted (we infer that
 * from audit events `rejected → submitted → approved` clusters; for now we
 * just show "approved" / "draft" / etc. + the latest approver.)
 */
export async function getApprovalHistoryForPerson(
  personId: string,
  weeksBack: number = 4,
): Promise<ApprovalHistoryRow[]> {
  const now = new Date();
  // Anchor on Monday of the current week, then walk back.
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dow = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  const earliest = new Date(monday.getTime() - weeksBack * 7 * 86_400_000);
  const entries = await prisma.timesheetEntry.findMany({
    where: { personId, date: { gte: earliest } },
    select: {
      date: true,
      hours: true,
      status: true,
      approvedById: true,
    },
  });
  const approverIds = Array.from(
    new Set(entries.map((e) => e.approvedById).filter((id): id is string => id !== null)),
  );
  const approvers = approverIds.length
    ? await prisma.person.findMany({
        where: { id: { in: approverIds } },
        select: { id: true, initials: true },
      })
    : [];
  const approverByIdMap = new Map(approvers.map((p) => [p.id, p.initials]));

  const buckets = new Map<
    string,
    {
      weekStart: Date;
      hours: number;
      statuses: Set<'draft' | 'submitted' | 'approved' | 'billed'>;
      approverInitials: string | null;
    }
  >();
  for (const e of entries) {
    const d = new Date(
      Date.UTC(e.date.getUTCFullYear(), e.date.getUTCMonth(), e.date.getUTCDate()),
    );
    const wDow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (wDow === 0 ? -6 : 1 - wDow));
    const key = d.toISOString();
    const cur =
      buckets.get(key) ??
      ({
        weekStart: d,
        hours: 0,
        statuses: new Set<'draft' | 'submitted' | 'approved' | 'billed'>(),
        approverInitials: null,
      } satisfies NonNullable<ReturnType<(typeof buckets)['get']>>);
    cur.hours += Number(e.hours);
    cur.statuses.add(e.status);
    const approverInitials = e.approvedById ? approverByIdMap.get(e.approvedById) : null;
    if (approverInitials && !cur.approverInitials) {
      cur.approverInitials = approverInitials;
    }
    buckets.set(key, cur);
  }

  const rows: ApprovalHistoryRow[] = [];
  for (let i = 0; i < weeksBack + 1; i += 1) {
    const ws = new Date(monday.getTime() - i * 7 * 86_400_000);
    const b = buckets.get(ws.toISOString());
    let status: ApprovalHistoryRow['status'] = 'draft';
    if (b) {
      if (b.statuses.size === 1) {
        status = ([...b.statuses][0] as ApprovalHistoryRow['status']) ?? 'draft';
      } else if (b.statuses.size > 1) {
        status = 'mixed';
      }
    }
    rows.push({
      weekStart: ws,
      status,
      approverInitials: b?.approverInitials ?? null,
      totalHours: b?.hours ?? 0,
      isCurrentWeek: i === 0,
    });
  }
  return rows;
}

export type AvailabilityWeek = {
  weekStart: Date;
  scheduledHours: number; // sum of allocationPct × 38h across active projects
  bookedHours: number; // hours already on timesheet entries for that week
  byProject: Array<{
    projectId: string;
    projectCode: string;
    projectName: string;
    allocationPct: number;
    scheduledHours: number;
    bookedHours: number;
  }>;
};

/**
 * Lightweight availability roll-up for the next `weeks` weeks. Schedule comes
 * from the person's active ProjectTeam allocations × 38h baseline; booked
 * hours come from any TimesheetEntry already in the period (so the forecast
 * shows depleted capacity for past weeks). No FTE / target arithmetic — just
 * scheduled vs booked, per the user's "remove targets" steer.
 */
export async function getAvailabilityForecast(
  personId: string,
  weeks: number = 6,
): Promise<AvailabilityWeek[]> {
  const now = new Date();
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dow = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  const horizonEnd = new Date(monday.getTime() + weeks * 7 * 86_400_000);

  const [team, entries] = await Promise.all([
    prisma.projectTeam.findMany({
      where: { personId, project: { stage: { not: 'archived' } } },
      include: {
        project: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.timesheetEntry.findMany({
      where: {
        personId,
        date: { gte: monday, lt: horizonEnd },
      },
      select: { projectId: true, date: true, hours: true },
    }),
  ]);

  const result: AvailabilityWeek[] = [];
  for (let w = 0; w < weeks; w += 1) {
    const ws = new Date(monday.getTime() + w * 7 * 86_400_000);
    const we = new Date(ws.getTime() + 7 * 86_400_000);

    const byProject = team.map((t) => {
      const scheduled = Math.round((t.allocationPct / 100) * 38);
      const booked = entries
        .filter(
          (e) =>
            e.projectId === t.project.id &&
            e.date.getTime() >= ws.getTime() &&
            e.date.getTime() < we.getTime(),
        )
        .reduce((s, e) => s + Number(e.hours), 0);
      return {
        projectId: t.project.id,
        projectCode: t.project.code,
        projectName: t.project.name,
        allocationPct: t.allocationPct,
        scheduledHours: scheduled,
        bookedHours: booked,
      };
    });

    const scheduledHours = byProject.reduce((s, p) => s + p.scheduledHours, 0);
    const bookedHours = byProject.reduce((s, p) => s + p.bookedHours, 0);
    result.push({ weekStart: ws, scheduledHours, bookedHours, byProject });
  }
  return result;
}

export type QuickAddProjectMatch = {
  projectId: string;
  projectCode: string;
  projectName: string;
};

/**
 * Resolve a ⌘K-style natural language entry. Accepts loose syntax:
 *   "ifm001 thu 8"
 *   "bd pnc002 tue 2h"
 *   "thu ifm001 8.5"
 *
 * Returns the structured fields the grid needs to drop into a row. Project
 * lookup is case-insensitive on `code`.
 */
const DAY_TOKENS: Record<string, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 0,
};

export function parseQuickAddInput(input: string): {
  projectCode: string | null;
  dayOfWeek: number | null; // 0 (Sun) - 6 (Sat); 1 = Mon
  hours: number | null;
  modifiers: string[]; // e.g. ['bd'] when prefixed
  raw: string;
} {
  const tokens = input.trim().split(/\s+/);
  let projectCode: string | null = null;
  let dayOfWeek: number | null = null;
  let hours: number | null = null;
  const modifiers: string[] = [];
  for (const t of tokens) {
    const lower = t.toLowerCase().replace(/[hH]$/, '');
    if (DAY_TOKENS[lower] !== undefined) {
      dayOfWeek = DAY_TOKENS[lower] ?? null;
    } else if (/^[A-Za-z]{2,4}\d{2,5}$/.test(t)) {
      projectCode = t.toUpperCase();
    } else if (/^[0-9]+(?:\.[0-9]+)?$/.test(lower)) {
      hours = Number(lower);
    } else if (/^(bd|delivery|opex|firm)$/i.test(t)) {
      modifiers.push(t.toLowerCase());
    }
  }
  return { projectCode, dayOfWeek, hours, modifiers, raw: input.trim() };
}
