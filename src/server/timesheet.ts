import { prisma } from '@/server/db';
import { type Prisma, type TimesheetPeriodState } from '@prisma/client';
import type { Session } from '@/server/roles';
import {
  addDays,
  daysInMonth,
  formatMonthLabel,
  monthNumber,
  monthStartFrom,
  startOfMonth,
} from '@/lib/week';

/**
 * What the UI shows for an entry. Wider than the DB enum: `billed` is a
 * DERIVED state, not a stored one.
 *
 * TASK-500 removed `billed` from `TimesheetStatus` because it was doing two
 * incompatible jobs — recording that the contractor had invoiced Foundry (AP)
 * while simultaneously, as a side effect of `previewInvoiceFromTimesheets`
 * filtering `status='approved'`, excluding the hour from client invoicing
 * (AR). The two legs now carry their own FKs and neither gates the other.
 *
 * `billed` here means the **AR leg only** — this hour is on a client invoice.
 * That is what every surface using the word already claims ("on invoice",
 * "linked to invoice"), and before TASK-500 the label was simply wrong: it
 * was driven by the contractor-bill flow, so it counted hours Foundry had
 * been invoiced FOR, not hours it had invoiced OUT.
 *
 * For "has either leg consumed this hour?" — the edit-lock / delete-guard
 * question — use `isBilledEitherLeg`, never the display status. Keeping the
 * two apart is the whole point of the task: an hour can sit on a contractor
 * bill and still be perfectly billable to the client.
 */
export type TimesheetDisplayStatus = 'draft' | 'submitted' | 'approved' | 'billed';

export type BillingLegs = {
  /** AR leg — on a client invoice. */
  billedInvoiceId: string | null;
  /** AP leg — on a contractor bill to Foundry. */
  contractorBillId: string | null;
};

/**
 * True once EITHER leg has consumed the hour — i.e. editing or deleting it
 * now has a downstream document to reconcile. Use for locks and guards, not
 * for anything labelled "invoiced".
 */
export function isBilledEitherLeg(e: BillingLegs): boolean {
  return e.billedInvoiceId !== null || e.contractorBillId !== null;
}

/** Display status. `billed` = on a client invoice (AR leg). */
export function toDisplayStatus(
  e: Pick<BillingLegs, 'billedInvoiceId'> & { status: 'draft' | 'submitted' | 'approved' },
): TimesheetDisplayStatus {
  return e.status === 'approved' && e.billedInvoiceId !== null ? 'billed' : e.status;
}

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
  status: TimesheetDisplayStatus | 'mixed';
  cells: TimesheetCell[];
};

/**
 * A person's grid for one REAL calendar month (28–31 days).
 *
 * Was a rolling 28-day block anchored on the current week, which drifted and
 * never aligned to a named month — so a contractor could not select the
 * period they needed to invoice for (TASK-501). Takes the month start rather
 * than (year, month) to mirror `getWeekForPerson(personId, weekStart)`; use
 * `monthStartFrom(year, month)` from lib/week to convert.
 */
export async function getMonthForPerson(
  personId: string,
  monthStart: Date,
): Promise<TimesheetRow[]> {
  const start = startOfMonth(monthStart);
  return getRangeForPerson(
    personId,
    start,
    daysInMonth(start.getUTCFullYear(), monthNumber(start)),
  );
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
      const statuses = new Set(projectEntries.map(toDisplayStatus));
      const status: TimesheetRow['status'] =
        statuses.size === 0
          ? 'draft'
          : statuses.size > 1
            ? 'mixed'
            : (statuses.values().next().value ?? 'draft');

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
  /** Derived — see toDisplayStatus. `billed` means either leg consumed it. */
  status: TimesheetDisplayStatus;
  approvedAt: Date | null;
  billedInvoiceId: string | null;
  contractorBillId: string | null;
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
    status: toDisplayStatus(e),
    approvedAt: e.approvedAt,
    billedInvoiceId: e.billedInvoiceId,
    contractorBillId: e.contractorBillId,
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
  /** Derived — see toDisplayStatus. `billed` means either leg consumed it. */
  status: TimesheetDisplayStatus;
  approvedAt: Date | null;
  billedInvoiceId: string | null;
  contractorBillId: string | null;
  project: { id: string; code: string; name: string };
};

export async function listPersonTimesheetEntries(
  personId: string,
  opts: { from?: Date; to?: Date; status?: 'draft' | 'submitted' | 'approved' } = {},
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
    status: toDisplayStatus(e),
    approvedAt: e.approvedAt,
    billedInvoiceId: e.billedInvoiceId,
    contractorBillId: e.contractorBillId,
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

  // AP-leg candidates: approved hours this contractor hasn't yet invoiced
  // Foundry for. Gated on `contractorBillId`, NOT `billedInvoiceId` — whether
  // the client has been invoiced for an hour has no bearing on whether the
  // contractor has been paid for it, and vice versa (TASK-500).
  const entries = await prisma.timesheetEntry.findMany({
    where: { personId, status: 'approved', contractorBillId: null },
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
  status: TimesheetDisplayStatus | 'mixed' | 'flag_resolved';
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
      billedInvoiceId: true,
      contractorBillId: true,
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
      statuses: Set<TimesheetDisplayStatus>;
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
        statuses: new Set<TimesheetDisplayStatus>(),
        approverInitials: null,
      } satisfies NonNullable<ReturnType<(typeof buckets)['get']>>);
    cur.hours += Number(e.hours);
    cur.statuses.add(toDisplayStatus(e));
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

// ─── Approval decisions ──────────────────────────────────────────────────

export type DecidableEntry = {
  id: string;
  personId: string;
  status: 'draft' | 'submitted' | 'approved' | 'billed';
};

export type DecisionPartition<T extends DecidableEntry> = {
  /** Rows the decision can actually move — status `submitted`. */
  decidable: T[];
  /** Rows that exist but were already actioned somewhere else. */
  alreadyDecided: T[];
  /** Ids the caller asked for that no longer exist at all. */
  missingCount: number;
};

/**
 * Split a requested batch of entry ids into what a decision can move vs
 * what has already moved. The approval queue used to require every
 * requested id to still be `submitted` and abandoned the whole batch
 * otherwise — so one stale id (recalled by the submitter, decided in
 * another tab, or auto-approved from the person's own sheet) silently
 * failed the entire decision and left the card sitting in the queue.
 * Partitioning lets the action decide the movable rows and report the
 * rest instead of stalling.
 */
export function partitionDecisionBatch<T extends DecidableEntry>(
  requestedIds: string[],
  found: T[],
): DecisionPartition<T> {
  return {
    decidable: found.filter((e) => e.status === 'submitted'),
    alreadyDecided: found.filter((e) => e.status !== 'submitted'),
    missingCount: Math.max(0, new Set(requestedIds).size - found.length),
  };
}

// ─── Lodgement periods (person × calendar month) ────────────────────────────

export type TimesheetPeriodSummary = {
  id: string;
  personId: string;
  year: number;
  month: number;
  /** UTC midnight on the 1st — the anchor the grid and actions work from. */
  monthStart: Date;
  state: TimesheetPeriodState;
  lodgedAt: Date | null;
  approvedAt: Date | null;
  invoicedAt: Date | null;
  contractorBillId: string | null;
};

function toPeriodSummary(row: {
  id: string;
  personId: string;
  year: number;
  month: number;
  state: TimesheetPeriodState;
  lodgedAt: Date | null;
  approvedAt: Date | null;
  invoicedAt: Date | null;
  contractorBillId: string | null;
}): TimesheetPeriodSummary {
  return { ...row, monthStart: monthStartFrom(row.year, row.month) };
}

/**
 * The period row for a person × month, created on first read.
 *
 * Lazy creation rather than a backfill: a month with no row is `open` by
 * definition, so history needs no migration and a person who never logs a
 * given month never gets a row for it.
 *
 * Races (two tabs, a double-tap, a WhatsApp log landing mid-read) resolve on
 * the `(personId, year, month)` unique index — the upsert makes this safe to
 * call from anywhere without a transaction.
 */
export async function getOrCreateTimesheetPeriod(
  personId: string,
  monthStart: Date,
): Promise<TimesheetPeriodSummary> {
  const start = startOfMonth(monthStart);
  const year = start.getUTCFullYear();
  const month = monthNumber(start);
  const row = await prisma.timesheetPeriod.upsert({
    where: { personId_year_month: { personId, year, month } },
    create: { personId, year, month },
    update: {},
  });
  return toPeriodSummary(row);
}

/**
 * Read-only lookup — does NOT create. Use where a missing row should read as
 * `open` without writing (listings, dashboards, anything that might run for
 * many people at once).
 */
export async function findTimesheetPeriod(
  personId: string,
  monthStart: Date,
): Promise<TimesheetPeriodSummary | null> {
  const start = startOfMonth(monthStart);
  const row = await prisma.timesheetPeriod.findUnique({
    where: {
      personId_year_month: {
        personId,
        year: start.getUTCFullYear(),
        month: monthNumber(start),
      },
    },
  });
  return row ? toPeriodSummary(row) : null;
}

/** Hours + entry counts for a person's month, bucketed by DB status. */
export type PeriodTotals = {
  totalHours: number;
  draftHours: number;
  submittedHours: number;
  approvedHours: number;
  entryCount: number;
  projectCount: number;
};

export async function getPeriodTotals(
  personId: string,
  monthStart: Date,
): Promise<PeriodTotals> {
  const start = startOfMonth(monthStart);
  const end = addDays(start, daysInMonth(start.getUTCFullYear(), monthNumber(start)));
  const entries = await prisma.timesheetEntry.findMany({
    where: { personId, date: { gte: start, lt: end } },
    select: { hours: true, status: true, projectId: true },
  });
  const totals: PeriodTotals = {
    totalHours: 0,
    draftHours: 0,
    submittedHours: 0,
    approvedHours: 0,
    entryCount: entries.length,
    projectCount: new Set(entries.map((e) => e.projectId)).size,
  };
  for (const e of entries) {
    const h = Number(e.hours);
    totals.totalHours += h;
    if (e.status === 'draft') totals.draftHours += h;
    else if (e.status === 'submitted') totals.submittedHours += h;
    else totals.approvedHours += h;
  }
  return totals;
}

// ─── Auto-approve rules (shared by saveTimesheet and lodgeMonth) ────────────

export type AutoApproveProject = {
  id: string;
  stage: string;
  managerId: string | null;
  primaryPartnerId: string | null;
};

/**
 * Which projects' rows skip the approval queue on this write.
 *
 *   - super_admin: every project (own hours and on-behalf alike)
 *   - on-behalf write by admin / the project's manager / its primary partner:
 *     that project only — the leader's edit IS the approval
 *   - everyone else: none; standard draft → submitted → approved
 *
 * Override: archived (closed) projects ALWAYS require explicit approval
 * (TT 2026-06-16). Late hours on a wrapped engagement should never skip the
 * queue, even for a super-admin self-save — the project is closed and the
 * manager needs a chance to challenge the entry.
 *
 * Extracted from saveTimesheet in TASK-502 so the monthly lodge action can't
 * drift from the daily save path. Two copies of this would eventually
 * disagree about who skips the queue, which is the sort of divergence nobody
 * notices until an unapproved month lands in P&L.
 */
export function resolveAutoApproveProjectIds(opts: {
  isSuperAdmin: boolean;
  isAdminGroup: boolean;
  actingOnBehalf: boolean;
  actorPersonId: string;
  projects: AutoApproveProject[];
}): Set<string> {
  const { isSuperAdmin, isAdminGroup, actingOnBehalf, actorPersonId, projects } = opts;
  const ids = new Set<string>();
  const eligible = projects.filter((p) => p.stage !== 'archived');
  if (isSuperAdmin) {
    for (const p of eligible) ids.add(p.id);
    return ids;
  }
  if (!actingOnBehalf) return ids;
  for (const p of eligible) {
    if (isAdminGroup || p.managerId === actorPersonId || p.primaryPartnerId === actorPersonId) {
      ids.add(p.id);
    }
  }
  return ids;
}

// ─── Lodge-the-month preflight ──────────────────────────────────────────────

export type LodgeWarningCode =
  | 'month_not_finished'
  | 'zero_hour_weekdays'
  | 'off_team_projects'
  | 'already_lodged';

export type LodgeWarning = {
  code: LodgeWarningCode;
  message: string;
};

export type LodgePreflight = {
  monthStart: Date;
  monthLabel: string;
  /** Entries that lodging would move draft → submitted. */
  promotableEntryIds: string[];
  totalHours: number;
  projectCount: number;
  /** Hard stop — lodging is refused while set. */
  blocker: string | null;
  warnings: LodgeWarning[];
};

/**
 * Everything the lodge action needs to decide, computed before any write.
 *
 * The split matters: a `blocker` refuses the lodge outright, while `warnings`
 * are things a person may legitimately intend (a part-month contractor, a
 * month lodged early before annual leave) and can wave through. Refusing
 * those outright would be wrong; staying silent about them would let a
 * half-finished month get invoiced.
 */
export async function preflightLodgeMonth(
  personId: string,
  monthStart: Date,
  today: Date,
): Promise<LodgePreflight> {
  const start = startOfMonth(monthStart);
  const dayCount = daysInMonth(start.getUTCFullYear(), monthNumber(start));
  const end = addDays(start, dayCount);

  const [entries, teamRows, period] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { personId, date: { gte: start, lt: end } },
      select: { id: true, date: true, hours: true, status: true, projectId: true,
                project: { select: { code: true } } },
    }),
    prisma.projectTeam.findMany({ where: { personId }, select: { projectId: true } }),
    findTimesheetPeriod(personId, start),
  ]);

  const promotableEntryIds = entries.filter((e) => e.status === 'draft').map((e) => e.id);
  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);
  const projectIds = new Set(entries.map((e) => e.projectId));

  const warnings: LodgeWarning[] = [];

  // Already past approval — lodging again would be meaningless and would
  // reopen a settled month.
  let blocker: string | null = null;
  if (period?.state === 'approved' || period?.state === 'invoiced') {
    blocker = `${formatMonthLabel(start)} is already ${period.state}. Ask an approver to send it back if it needs changing.`;
  } else if (entries.length === 0 || totalHours === 0) {
    blocker = `No hours logged in ${formatMonthLabel(start)} — there is nothing to lodge.`;
  }

  if (period?.state === 'lodged') {
    warnings.push({
      code: 'already_lodged',
      message: `${formatMonthLabel(start)} is already lodged. Lodging again picks up anything added since.`,
    });
  }

  // Lodging a month that hasn't ended is legitimate (leave, an early
  // invoice run) but is usually a misclick on the month picker.
  if (end > today) {
    warnings.push({
      code: 'month_not_finished',
      message: `${formatMonthLabel(start)} hasn't finished yet — you can still add hours to it after lodging, but they'll need lodging again.`,
    });
  }

  // Weekdays with nothing logged. Mon–Fri only; a contractor working
  // weekends is not the common case and flagging Saturdays would be noise.
  const workedDays = new Set(entries.filter((e) => Number(e.hours) > 0)
    .map((e) => e.date.toISOString().slice(0, 10)));
  const emptyWeekdays: string[] = [];
  for (let i = 0; i < dayCount; i += 1) {
    const d = addDays(start, i);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (d >= today) continue; // don't nag about days that haven't happened
    if (!workedDays.has(d.toISOString().slice(0, 10))) emptyWeekdays.push(d.toISOString().slice(0, 10));
  }
  if (emptyWeekdays.length > 0) {
    warnings.push({
      code: 'zero_hour_weekdays',
      message: `${emptyWeekdays.length} weekday${emptyWeekdays.length === 1 ? '' : 's'} with no hours logged (${emptyWeekdays.slice(0, 3).join(', ')}${emptyWeekdays.length > 3 ? ', …' : ''}).`,
    });
  }

  // Hours against a project the person isn't rostered on. Usually fine —
  // saveTimesheet auto-adds the team row — but worth surfacing before the
  // month becomes an invoice.
  const teamProjectIds = new Set(teamRows.map((r) => r.projectId));
  const offTeam = Array.from(
    new Set(
      entries.filter((e) => !teamProjectIds.has(e.projectId)).map((e) => e.project.code),
    ),
  );
  if (offTeam.length > 0) {
    warnings.push({
      code: 'off_team_projects',
      message: `Hours logged on ${offTeam.join(', ')} — you're not on the project team${offTeam.length === 1 ? '' : 's'}.`,
    });
  }

  return {
    monthStart: start,
    monthLabel: formatMonthLabel(start),
    promotableEntryIds,
    totalHours,
    projectCount: projectIds.size,
    blocker,
    warnings,
  };
}

// ─── Period state reconciliation ────────────────────────────────────────────

export type MonthKey = { year: number; month: number };

/** The (year, month) buckets a set of dated rows falls into. */
export function monthKeysFor(dates: Date[]): MonthKey[] {
  const seen = new Map<string, MonthKey>();
  for (const d of dates) {
    const key = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    seen.set(`${key.year}-${key.month}`, key);
  }
  return Array.from(seen.values());
}

/**
 * Re-derive a person's period state from the entries actually in the month.
 *
 * Called after any approval decision. The period is a roll-up, so it must
 * never be set directly from "what this decision did" — a manager who leads
 * one of three projects approves their slice and the month is still
 * outstanding. Only "every entry in the month is approved" closes it (D2,
 * TT 2026-08-31), which is what gives a contractor one invoice per month
 * instead of one per approver.
 *
 * Deliberately does NOT create period rows. A row existing means the person
 * lodged that month; that invariant is what lets TASK-504 fire an invoice on
 * close without also firing for people who only ever submitted week by week.
 *
 * `invoiced` is terminal here — a late decision must never silently reopen a
 * month that has already been billed.
 */
export type ClosedPeriod = {
  personId: string;
  year: number;
  month: number;
  monthLabel: string;
  /** Null when the person is full-time — no invoice is ever raised. */
  draft: { rateCents: number; hours: number; amountExGstCents: number } | null;
};

export async function reconcileTimesheetPeriodStates(
  tx: Prisma.TransactionClient,
  personId: string,
  months: MonthKey[],
  now: Date,
): Promise<ClosedPeriod[]> {
  const closed: ClosedPeriod[] = [];
  for (const { year, month } of months) {
    const period = await tx.timesheetPeriod.findUnique({
      where: { personId_year_month: { personId, year, month } },
      select: { id: true, state: true },
    });
    if (!period) continue;
    if (period.state === 'invoiced') continue;

    const start = monthStartFrom(year, month);
    const end = addDays(start, daysInMonth(year, month));
    const entries = await tx.timesheetEntry.findMany({
      where: { personId, date: { gte: start, lt: end } },
      select: { status: true },
    });

    let next: TimesheetPeriodState;
    if (entries.length === 0) {
      next = 'open';
    } else if (entries.every((e) => e.status === 'approved')) {
      next = 'approved';
    } else if (entries.some((e) => e.status === 'submitted')) {
      // Still partly with the approvers — a month one manager has cleared
      // but another hasn't stays lodged.
      next = 'lodged';
    } else {
      // Something was sent back to draft; the month is no longer a complete
      // submission and has to be re-lodged.
      next = 'open';
    }
    if (next === period.state) continue;

    // Closing the month is where the contractor's invoice numbers get
    // frozen. Doing it here rather than at confirm time means the figures
    // they're shown are the ones the approvals produced, whatever happens to
    // Person.rate afterwards.
    let draft: ClosedPeriod['draft'] = null;
    if (next === 'approved') {
      draft = await prepareContractorInvoiceDraft(tx, personId, year, month);
    }

    await tx.timesheetPeriod.update({
      where: { id: period.id },
      data: {
        state: next,
        approvedAt: next === 'approved' ? now : null,
        ...(next === 'open' ? { lodgedAt: null } : {}),
        // A reopened month's snapshot is stale by definition — clear it so a
        // later close recomputes rather than resurrecting old figures.
        ...(next === 'approved' && draft
          ? {
              draftRateCents: draft.rateCents,
              draftHours: draft.hours,
              draftAmountExGstCents: draft.amountExGstCents,
              draftPreparedAt: now,
            }
          : {
              draftRateCents: null,
              draftHours: null,
              draftAmountExGstCents: null,
              draftPreparedAt: null,
            }),
      },
    });

    if (next === 'approved') {
      closed.push({
        personId,
        year,
        month,
        monthLabel: formatMonthLabel(monthStartFrom(year, month)),
        draft,
      });
    }
  }
  return closed;
}

/**
 * Compute what the contractor will be asked to confirm for a closed month.
 *
 * Priced at `Person.rate` — the contractor's COST rate, what they invoice
 * Foundry — never `Person.billRate`, which is what Foundry charges the
 * client. Confusing the two would have a contractor invoice us at the client
 * rate.
 *
 * Returns null, and no invoice is ever offered, when the person is full-time
 * (paid via pay runs), has no rate on file, or the month somehow has no
 * hours. A missing rate is a data problem for an admin, not something to
 * paper over with a zero-dollar invoice.
 */
async function prepareContractorInvoiceDraft(
  tx: Prisma.TransactionClient,
  personId: string,
  year: number,
  month: number,
): Promise<ClosedPeriod['draft']> {
  const person = await tx.person.findUnique({
    where: { id: personId },
    select: { employment: true, rate: true },
  });
  if (!person || person.employment !== 'contractor') return null;
  const rateCents = person.rate ?? 0;
  if (rateCents <= 0) return null;

  const start = monthStartFrom(year, month);
  const end = addDays(start, daysInMonth(year, month));
  const entries = await tx.timesheetEntry.findMany({
    where: { personId, date: { gte: start, lt: end }, status: 'approved' },
    select: { hours: true },
  });
  const hours = entries.reduce((sum, e) => sum + Number(e.hours), 0);
  if (hours <= 0) return null;

  return {
    rateCents,
    hours,
    amountExGstCents: Math.round(hours * rateCents),
  };
}

// ─── Approval queue, grouped by person × month ──────────────────────────────

export type PendingProjectGroup = {
  projectId: string;
  projectCode: string;
  projectName: string;
  hours: number;
  entryIds: string[];
  /** Can the viewer decide this project's rows? */
  canDecide: boolean;
  /** Who owes the decision when the viewer can't make it. */
  owedByPersonId: string | null;
};

export type PendingMonthCard = {
  personId: string;
  personName: string;
  initials: string;
  headshotUrl: string | null;
  year: number;
  month: number;
  monthStart: Date;
  monthLabel: string;
  /** Null when the person submitted week-by-week without lodging a month. */
  periodState: TimesheetPeriodState | null;
  projects: PendingProjectGroup[];
  totalHours: number;
  /** Hours the viewer can act on right now. */
  decidableHours: number;
  decidableEntryIds: string[];
  entries: Array<{
    id: string;
    date: Date;
    hours: number;
    description: string;
    projectCode: string;
    projectName: string;
    canDecide: boolean;
  }>;
};

/**
 * The approval queue as person-months.
 *
 * Was person × ISO week, which shattered one monthly lodgement into five
 * cards and made a manager approve the same person five times — the opposite
 * of the batch approval the monthly workflow is for (TASK-503).
 *
 * Scoping is per project, not per card: a manager who leads one of three
 * projects sees the whole month for context but can only decide their slice.
 * The rest is shown greyed with who owes it, so the submitter can chase the
 * right person instead of guessing.
 */
export async function listPendingMonthCards(session: Session): Promise<PendingMonthCard[]> {
  const roles = session.person.roles;
  const canSeeAll = roles.includes('super_admin') || roles.includes('admin');
  const entries = await prisma.timesheetEntry.findMany({
    where: canSeeAll
      ? { status: 'submitted' }
      : {
          status: 'submitted',
          project: {
            OR: [
              { managerId: session.person.id },
              { primaryPartnerId: session.person.id },
            ],
          },
        },
    orderBy: [{ date: 'asc' }],
    include: {
      person: {
        select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
      },
      project: {
        select: { id: true, code: true, name: true, managerId: true, primaryPartnerId: true },
      },
    },
  });
  if (entries.length === 0) return [];

  // Non-admins get the rest of each month for context. Without this the card
  // claims a month is 8h when it's 140h, and the submitter can't tell who
  // still owes them a decision.
  const contextEntries = canSeeAll
    ? entries
    : await prisma.timesheetEntry.findMany({
        where: {
          status: 'submitted',
          personId: { in: Array.from(new Set(entries.map((e) => e.personId))) },
        },
        orderBy: [{ date: 'asc' }],
        include: {
          person: {
            select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
          },
          project: {
            select: { id: true, code: true, name: true, managerId: true, primaryPartnerId: true },
          },
        },
      });

  const canDecideProject = (p: { managerId: string | null; primaryPartnerId: string | null }) =>
    canSeeAll || p.managerId === session.person.id || p.primaryPartnerId === session.person.id;

  const cards = new Map<string, PendingMonthCard>();
  for (const e of contextEntries) {
    const year = e.date.getUTCFullYear();
    const month = e.date.getUTCMonth() + 1;
    const key = `${e.personId}|${year}-${month}`;
    let card = cards.get(key);
    if (!card) {
      const monthStart = monthStartFrom(year, month);
      card = {
        personId: e.personId,
        personName: `${e.person.firstName} ${e.person.lastName}`,
        initials: e.person.initials,
        headshotUrl: e.person.headshotUrl,
        year,
        month,
        monthStart,
        monthLabel: formatMonthLabel(monthStart),
        periodState: null,
        projects: [],
        totalHours: 0,
        decidableHours: 0,
        decidableEntryIds: [],
        entries: [],
      };
      cards.set(key, card);
    }
    const hours = Number(e.hours);
    const mine = canDecideProject(e.project);

    let group = card.projects.find((g) => g.projectId === e.projectId);
    if (!group) {
      group = {
        projectId: e.projectId,
        projectCode: e.project.code,
        projectName: e.project.name,
        hours: 0,
        entryIds: [],
        canDecide: mine,
        owedByPersonId: mine ? null : (e.project.managerId ?? e.project.primaryPartnerId),
      };
      card.projects.push(group);
    }
    group.hours += hours;
    group.entryIds.push(e.id);

    card.totalHours += hours;
    if (mine) {
      card.decidableHours += hours;
      card.decidableEntryIds.push(e.id);
    }
    card.entries.push({
      id: e.id,
      date: e.date,
      hours,
      description: e.description ?? '',
      projectCode: e.project.code,
      projectName: e.project.name,
      canDecide: mine,
    });
  }

  const list = Array.from(cards.values()).filter((c) => c.decidableEntryIds.length > 0);

  // Attach lodgement state so the card can say whether this is a lodged
  // month or loose weekly submissions.
  const periods = await prisma.timesheetPeriod.findMany({
    where: {
      OR: list.map((c) => ({ personId: c.personId, year: c.year, month: c.month })),
    },
    select: { personId: true, year: true, month: true, state: true },
  });
  const periodByKey = new Map(
    periods.map((p) => [`${p.personId}|${p.year}-${p.month}`, p.state]),
  );
  for (const c of list) {
    c.periodState = periodByKey.get(`${c.personId}|${c.year}-${c.month}`) ?? null;
    c.projects.sort((a, b) => a.projectCode.localeCompare(b.projectCode));
  }

  // Oldest month first — the longest-waiting contractor is the one whose
  // invoice is most overdue.
  return list.sort(
    (a, b) =>
      a.monthStart.getTime() - b.monthStart.getTime() ||
      a.personName.localeCompare(b.personName),
  );
}
