import { prisma } from '@/server/db';
import { type Prisma, type TimesheetPeriodState } from '@prisma/client';
import type { Session } from '@/server/roles';
import {
  addDays,
  addMonths,
  daysInMonth,
  formatMonthLabel,
  formatMonthShortLabel,
  monthNumber,
  monthStartFrom,
  quarterMonths,
  startOfMonth,
  startOfQuarter,
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
  /**
   * Status of the entry behind this day, or null when nothing is logged.
   *
   * Per-CELL rather than per-row because a row routinely spans a boundary —
   * last week approved, this week still draft — and the row-level `mixed`
   * status could not say which days were which. The grid locked the whole
   * row or none of it, so in a mixed row an already-approved day rendered as
   * an open input that silently discarded whatever was typed into it (the
   * save action has always refused to rewrite an approved entry). Browsing
   * back through past weeks is exactly when that happens.
   */
  status: TimesheetDisplayStatus | null;
  /**
   * True once either billing leg has consumed the hour (client invoice or
   * contractor bill). Harder lock than `approved`: a super-admin override
   * can still edit an approved hour, but not one that is on a document.
   */
  billed: boolean;
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
    // Previous CALENDAR month, not "31 days back" — February has to carry
    // January forward, not part of it.
    { start: addMonths(start, -1), end: start },
  );
}

export async function getWeekForPerson(
  personId: string,
  weekStart: Date,
  /**
   * Set false to get the plain allocation-based view. Used by the "Copy last
   * week" lookup, which wants last week's actual hours and would otherwise
   * recurse a week further back for its row list.
   */
  carryForwardPrevious: boolean = true,
): Promise<TimesheetRow[]> {
  return getRangeForPerson(
    personId,
    weekStart,
    7,
    carryForwardPrevious
      ? { start: addDays(weekStart, -7), end: weekStart }
      : undefined,
  );
}

async function getRangeForPerson(
  personId: string,
  rangeStart: Date,
  days: number,
  /**
   * The period immediately before this one. When given, the sheet opens with
   * the projects worked THEN, instead of every project the person is
   * allocated to (TASK-510, TT 2026-10-23).
   *
   * Allocation is a poor proxy for "what I'm actually working on": people sit
   * on project teams for months without touching them, and every one of those
   * rows had to be manually removed from a sheet they were never going to
   * fill in. Carrying the previous period forward self-cleans — a project
   * drops off the moment you stop logging to it, because a zero-hour row
   * leaves no TimesheetEntry behind.
   */
  carryForward?: { start: Date; end: Date },
): Promise<TimesheetRow[]> {
  const rangeEnd = addDays(rangeStart, days);

  const projectSelect = {
    project: { select: { id: true, code: true, name: true, stage: true } },
  } as const;

  const [entries, assignments, previousEntries] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: {
        personId,
        date: { gte: rangeStart, lt: rangeEnd },
      },
      include: projectSelect,
    }),
    prisma.projectTeam.findMany({
      where: {
        personId,
        project: { stage: { not: 'archived' } },
      },
      include: projectSelect,
    }),
    carryForward
      ? prisma.timesheetEntry.findMany({
          where: {
            personId,
            date: { gte: carryForward.start, lt: carryForward.end },
            // Don't carry a project that has since been archived — logging
            // to a wrapped engagement should be a deliberate act via the
            // add-row picker, not something the sheet suggests.
            project: { stage: { not: 'archived' } },
          },
          include: projectSelect,
          distinct: ['projectId'],
        })
      : Promise.resolve([]),
  ]);

  type ProjectMini = {
    id: string;
    code: string;
    name: string;
    stage: 'kickoff' | 'delivery' | 'closing' | 'archived' | 'standing' | 'benched';
  };
  const projectsMap = new Map<string, ProjectMini>();
  if (carryForward) {
    for (const e of previousEntries) projectsMap.set(e.project.id, e.project);
    // Nothing logged last period — a new starter, or someone back from
    // leave. Falling back to allocations beats handing them an empty grid
    // and leaving them to hunt through the picker for their own projects.
    if (projectsMap.size === 0) {
      for (const a of assignments) projectsMap.set(a.project.id, a.project);
    }
  } else {
    for (const a of assignments) projectsMap.set(a.project.id, a.project);
  }
  // Anything already logged in THIS period always shows, whatever its stage
  // or allocation — hiding a row that holds real hours would lose data.
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
          status: entry ? toDisplayStatus(entry) : null,
          billed: entry ? isBilledEitherLeg(entry) : false,
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

/**
 * Read-only roll-up of a whole quarter: projects down, the quarter's three
 * months across.
 *
 * A quarter is 90-odd days, so the editable day grid does not scale to it —
 * and reviewing a quarter is not an editing job anyway. This answers "what
 * did I log, and has it been signed off" at a glance, and each month cell
 * links through to the month grid for anything that still needs work.
 *
 * Only projects with hours in the quarter appear. Padding the rows out to
 * every project the person is rostered on (as the day grid does, so there is
 * somewhere to type) would bury three months of real activity under empty
 * rows.
 */
export type TimesheetSummaryStatus =
  | 'none'
  | TimesheetDisplayStatus
  | 'mixed';

export type TimesheetSummaryCell = {
  monthStart: Date;
  hours: number;
  status: TimesheetSummaryStatus;
  /** Hours that can no longer be edited here (approved or billed). */
  lockedHours: number;
};

export type TimesheetSummaryRow = {
  projectId: string;
  projectCode: string;
  projectName: string;
  projectStage: 'kickoff' | 'delivery' | 'closing' | 'archived' | 'standing' | 'benched';
  cells: TimesheetSummaryCell[];
  totalHours: number;
};

export type TimesheetQuarterSummary = {
  quarterStart: Date;
  months: Array<{
    start: Date;
    label: string;
    /** Lodgement state of the month. A month with no row is `open`. */
    state: TimesheetPeriodState;
    hours: number;
  }>;
  rows: TimesheetSummaryRow[];
  totalHours: number;
  lockedHours: number;
  /** Hours still sitting with an approver somewhere in the quarter. */
  submittedHours: number;
  /** Hours not yet submitted at all — the ones the person still has to act on. */
  draftHours: number;
};

export async function getQuarterSummaryForPerson(
  personId: string,
  anchorDate: Date,
): Promise<TimesheetQuarterSummary> {
  const quarterStart = startOfQuarter(anchorDate);
  const months = quarterMonths(quarterStart);
  const quarterEnd = addMonths(quarterStart, 3);

  const [entries, periods] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { personId, date: { gte: quarterStart, lt: quarterEnd } },
      select: {
        hours: true,
        date: true,
        status: true,
        billedInvoiceId: true,
        contractorBillId: true,
        project: { select: { id: true, code: true, name: true, stage: true } },
      },
    }),
    prisma.timesheetPeriod.findMany({
      where: {
        personId,
        OR: months.map((m) => ({
          year: m.getUTCFullYear(),
          month: monthNumber(m),
        })),
      },
      select: { year: true, month: true, state: true },
    }),
  ]);

  const periodState = new Map(
    periods.map((p) => [`${p.year}-${p.month}`, p.state] as const),
  );
  const monthIndex = new Map(
    months.map((m, i) => [`${m.getUTCFullYear()}-${monthNumber(m)}`, i] as const),
  );

  type Acc = {
    project: {
      id: string;
      code: string;
      name: string;
      stage: TimesheetSummaryRow['projectStage'];
    };
    cells: Array<{
      hours: number;
      locked: number;
      statuses: Set<TimesheetDisplayStatus>;
    }>;
  };
  const byProject = new Map<string, Acc>();
  const monthHours = months.map(() => 0);
  let totalHours = 0;
  let lockedHours = 0;
  let submittedHours = 0;
  let draftHours = 0;

  for (const e of entries) {
    const idx = monthIndex.get(
      `${e.date.getUTCFullYear()}-${e.date.getUTCMonth() + 1}`,
    );
    if (idx === undefined) continue;
    const hours = Number(e.hours);
    const display = toDisplayStatus(e);
    const locked = display === 'approved' || display === 'billed';

    let acc = byProject.get(e.project.id);
    if (!acc) {
      acc = {
        project: e.project,
        cells: months.map(() => ({ hours: 0, locked: 0, statuses: new Set() })),
      };
      byProject.set(e.project.id, acc);
    }
    const cell = acc.cells[idx]!;
    cell.hours += hours;
    cell.statuses.add(display);
    if (locked) cell.locked += hours;

    monthHours[idx] = (monthHours[idx] ?? 0) + hours;
    totalHours += hours;
    if (locked) lockedHours += hours;
    else if (display === 'submitted') submittedHours += hours;
    else draftHours += hours;
  }

  const rows: TimesheetSummaryRow[] = Array.from(byProject.values())
    .map((acc) => {
      const cells: TimesheetSummaryCell[] = acc.cells.map((c, i) => ({
        monthStart: months[i]!,
        hours: Number(c.hours.toFixed(2)),
        lockedHours: Number(c.locked.toFixed(2)),
        status:
          c.statuses.size === 0
            ? 'none'
            : c.statuses.size > 1
              ? 'mixed'
              : (c.statuses.values().next().value ?? 'none'),
      }));
      return {
        projectId: acc.project.id,
        projectCode: acc.project.code,
        projectName: acc.project.name,
        projectStage: acc.project.stage,
        cells,
        totalHours: Number(
          cells.reduce((s, c) => s + c.hours, 0).toFixed(2),
        ),
      };
    })
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode));

  return {
    quarterStart,
    months: months.map((m, i) => ({
      start: m,
      label: formatMonthShortLabel(m),
      state:
        periodState.get(`${m.getUTCFullYear()}-${monthNumber(m)}`) ?? 'open',
      hours: Number((monthHours[i] ?? 0).toFixed(2)),
    })),
    rows,
    totalHours: Number(totalHours.toFixed(2)),
    lockedHours: Number(lockedHours.toFixed(2)),
    submittedHours: Number(submittedHours.toFixed(2)),
    draftHours: Number(draftHours.toFixed(2)),
  };
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
  draft: {
  rateCents: number;
  hours: number;
  amountExGstCents: number;
  /**
   * Pass-through expenses on the same invoice (TASK-509). GST-INCLUSIVE:
   * D3 has the contractor invoice the full amount they paid and add no GST
   * of their own on these lines, with Foundry claiming the input credit.
   */
  expenseTotalCents: number;
  /** GST contained WITHIN expenseTotalCents, not added to it. */
  expenseGstCents: number;
  expenseCount: number;
} | null;
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
              draftExpenseTotalCents: draft.expenseTotalCents,
              draftExpenseGstCents: draft.expenseGstCents,
              draftExpenseCount: draft.expenseCount,
              draftPreparedAt: now,
            }
          : {
              draftRateCents: null,
              draftHours: null,
              draftAmountExGstCents: null,
              draftExpenseTotalCents: null,
              draftExpenseGstCents: null,
              draftExpenseCount: null,
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

  // Pass-through costs for the same month (TASK-509). Only `approved`
  // expenses tagged to a project and not already on a contractor bill:
  //   - `submitted` hasn't cleared review, so it isn't owed yet
  //   - `reimbursed` / `batched_for_payment` are already being paid the
  //     other way; putting them here as well pays twice
  //   - untagged (OPEX) expenses have no project Bill to join, because
  //     confirm raises one Bill per project
  const expenses = await tx.expense.findMany({
    where: {
      personId,
      date: { gte: start, lt: end },
      status: 'approved',
      contractorBillId: null,
      projectId: { not: null },
    },
    select: { amount: true, gst: true },
  });

  return {
    rateCents,
    hours,
    amountExGstCents: Math.round(hours * rateCents),
    // GST-inclusive by design (D3) — the contractor recharges what they paid.
    expenseTotalCents: expenses.reduce((sum, e) => sum + e.amount, 0),
    expenseGstCents: expenses.reduce((sum, e) => sum + e.gst, 0),
    expenseCount: expenses.length,
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

// ─── Contractor self-serve: my lodgement periods ────────────────────────────

export type MyInvoicePeriod = {
  year: number;
  month: number;
  monthStart: Date;
  monthLabel: string;
  state: TimesheetPeriodState;
  lodgedAt: Date | null;
  approvedAt: Date | null;
  invoicedAt: Date | null;
  /** Hours in the month, by DB status, so the card can explain what's left. */
  totals: PeriodTotals;
  /**
   * Approved expenses in the month with no project tag, which therefore
   * cannot join a project Bill and stay on the reimbursement path
   * (TASK-509). Surfaced so the contractor isn't left wondering where a
   * cost went.
   */
  excludedExpenseCount: number;
  /** Frozen at close; null until the month closes. */
  draft: {
  rateCents: number;
  hours: number;
  amountExGstCents: number;
  /**
   * Pass-through expenses on the same invoice (TASK-509). GST-INCLUSIVE:
   * D3 has the contractor invoice the full amount they paid and add no GST
   * of their own on these lines, with Foundry claiming the input credit.
   */
  expenseTotalCents: number;
  /** GST contained WITHIN expenseTotalCents, not added to it. */
  expenseGstCents: number;
  expenseCount: number;
} | null;
  /** Bills raised for this month, once the contractor has submitted. */
  bills: Array<{
    id: string;
    projectCode: string | null;
    supplierInvoiceNumber: string | null;
    amountTotal: number;
    status: string;
  }>;
};

/**
 * A person's own lodgement history, newest first — the spine of /me/invoices.
 *
 * Deliberately period-driven rather than bill-driven: a contractor needs to
 * see the months still waiting on approvers just as much as the ones already
 * invoiced, and a bill-driven list can only ever show the tail of that.
 */
export async function listMyInvoicePeriods(
  personId: string,
  limit = 18,
): Promise<MyInvoicePeriod[]> {
  const periods = await prisma.timesheetPeriod.findMany({
    where: { personId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: limit,
  });
  if (periods.length === 0) return [];

  // Bills for these months, resolved through the entries they cover — the
  // period's own contractorBillId only points at the first of a multi-project
  // month.
  const earliest = monthStartFrom(
    periods[periods.length - 1]!.year,
    periods[periods.length - 1]!.month,
  );
  const latest = periods[0]!;
  const latestEnd = addDays(
    monthStartFrom(latest.year, latest.month),
    daysInMonth(latest.year, latest.month),
  );
  // Approved but untagged (OPEX) expenses — excluded from the invoice
  // because confirm raises one Bill per project and these have none.
  const untaggedExpenses = await prisma.expense.findMany({
    where: {
      personId,
      date: { gte: earliest, lt: latestEnd },
      status: 'approved',
      contractorBillId: null,
      projectId: null,
    },
    select: { date: true },
  });
  const untaggedByMonth = new Map<string, number>();
  for (const x of untaggedExpenses) {
    const key = `${x.date.getUTCFullYear()}-${x.date.getUTCMonth() + 1}`;
    untaggedByMonth.set(key, (untaggedByMonth.get(key) ?? 0) + 1);
  }

  const billedEntries = await prisma.timesheetEntry.findMany({
    where: {
      personId,
      date: { gte: earliest, lt: latestEnd },
      contractorBillId: { not: null },
    },
    select: {
      date: true,
      contractorBillId: true,
      contractorBill: {
        select: {
          id: true,
          supplierInvoiceNumber: true,
          amountTotal: true,
          status: true,
          project: { select: { code: true } },
        },
      },
    },
  });
  const billsByMonth = new Map<string, MyInvoicePeriod['bills']>();
  for (const e of billedEntries) {
    if (!e.contractorBill) continue;
    const key = `${e.date.getUTCFullYear()}-${e.date.getUTCMonth() + 1}`;
    const list = billsByMonth.get(key) ?? [];
    if (!list.some((b) => b.id === e.contractorBill!.id)) {
      list.push({
        id: e.contractorBill.id,
        projectCode: e.contractorBill.project?.code ?? null,
        supplierInvoiceNumber: e.contractorBill.supplierInvoiceNumber,
        amountTotal: e.contractorBill.amountTotal,
        status: e.contractorBill.status,
      });
    }
    billsByMonth.set(key, list);
  }

  return Promise.all(
    periods.map(async (p) => {
      const monthStart = monthStartFrom(p.year, p.month);
      return {
        year: p.year,
        month: p.month,
        monthStart,
        monthLabel: formatMonthLabel(monthStart),
        state: p.state,
        lodgedAt: p.lodgedAt,
        approvedAt: p.approvedAt,
        invoicedAt: p.invoicedAt,
        totals: await getPeriodTotals(personId, monthStart),
        draft:
          p.draftRateCents !== null && p.draftAmountExGstCents !== null
            ? {
                rateCents: p.draftRateCents,
                hours: Number(p.draftHours ?? 0),
                amountExGstCents: p.draftAmountExGstCents,
                // Default to 0 rather than null for periods closed before
                // TASK-509 shipped — they carry no expense snapshot, and a
                // zero expense section is the truthful rendering.
                expenseTotalCents: p.draftExpenseTotalCents ?? 0,
                expenseGstCents: p.draftExpenseGstCents ?? 0,
                expenseCount: p.draftExpenseCount ?? 0,
              }
            : null,
        excludedExpenseCount: untaggedByMonth.get(`${p.year}-${p.month}`) ?? 0,
        bills: billsByMonth.get(`${p.year}-${p.month}`) ?? [],
      };
    }),
  );
}

// ─── Date-range contractor invoice (TASK-511) ───────────────────────────
//
// The month path (TASK-504/505) answers "invoice September". This answers
// "invoice 15 Sep – 14 Oct", which is what a contractor who started or
// finished mid-month, or who bills a quarter at a time, actually needs.
//
// Both paths converge on the same invariant: an hour is billable to Foundry
// iff `status = 'approved' AND contractorBillId IS NULL`. That single
// condition — not the period state — is what makes double-billing
// impossible, so a range overlapping an already-invoiced month simply picks
// up nothing from the billed part.

export type ContractorRangeGroup = {
  projectId: string;
  projectCode: string;
  projectName: string;
  hours: number;
  /** Sum over entries of hours × that entry's resolved rate, ex GST. */
  feesExGstCents: number;
  entryIds: string[];
  /** Pass-through costs, GST-INCLUSIVE (D3) — no GST is added on top. */
  expenseTotalCents: number;
  /** GST contained within expenseTotalCents, which Foundry reclaims. */
  expenseGstCents: number;
  expenseIds: string[];
};

/** Approved time in range that is NOT billable because it is already on a
 *  contractor bill, or time that has not been approved yet. Surfaced rather
 *  than silently dropped — "why is my invoice short" is answered by a name. */
export type ContractorRangePending = {
  projectId: string;
  projectCode: string;
  projectName: string;
  hours: number;
  /** 'draft' = contractor hasn't submitted; 'submitted' = with approvers. */
  status: 'draft' | 'submitted';
  /** Who can approve it — project manager + primary partner. */
  waitingOn: string[];
};

export type ContractorRangeRateNote = {
  /** Distinct hourly rates applied across the range, in cents. */
  ratesCents: number[];
  /** True when at least one entry priced at a frozen period rate. */
  usedFrozenRate: boolean;
  /** True when at least one entry priced at the contractor's current rate. */
  usedCurrentRate: boolean;
};

export type ContractorRangePreview = {
  /** Inclusive start, as supplied. */
  start: Date;
  /** Inclusive end, as supplied (queries use an exclusive end internally). */
  end: Date;
  groups: ContractorRangeGroup[];
  pending: ContractorRangePending[];
  /** Approved, unbilled, but untagged (OPEX) — no Bill to land on, so they
   *  stay on the reimbursement path. Count only; surfaced so the cost isn't
   *  simply missing. */
  excludedExpenseCount: number;
  rateNote: ContractorRangeRateNote;
  totals: {
    hours: number;
    feesExGstCents: number;
    feesGstCents: number;
    expenseTotalCents: number;
    expenseGstCents: number;
    amountTotalCents: number;
  };
  /** Non-fatal reasons the preview is empty or partial. */
  blockers: string[];
};

/** Hourly rate in cents to apply to one entry.
 *
 *  A period that closed with a snapshot prices at that snapshot; anything
 *  else prices at the contractor's current rate. This is the whole reason
 *  the range path needs per-entry rates rather than one rate for the window:
 *  a range spanning a closed September and an open October must not reprice
 *  September when `Person.rate` changes on 1 October. That silent repricing
 *  is exactly what TASK-504 froze the rate to prevent, and a naive range
 *  query reintroduces it.
 *
 *  Matches `prepareContractorInvoiceDraft` in treating `Person.rate` as
 *  cents-per-hour regardless of `rateUnit`, so the two paths can never
 *  disagree about what a month is worth. (Day-rate contractors are priced
 *  the same way by both; changing that is a separate decision applying to
 *  both paths at once.)
 */
function resolveEntryRateCents(
  date: Date,
  frozenByMonth: Map<string, number>,
  currentRateCents: number,
): { rateCents: number; frozen: boolean } {
  const key = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`;
  const frozen = frozenByMonth.get(key);
  if (frozen !== undefined && frozen > 0) return { rateCents: frozen, frozen: true };
  return { rateCents: currentRateCents, frozen: false };
}

/** Every (year, month) a [start, endExclusive) window touches. */
export function monthsInRange(start: Date, endExclusive: Date): MonthKey[] {
  const out: MonthKey[] = [];
  const cur = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  while (cur < endExclusive) {
    out.push({ year: cur.getUTCFullYear(), month: cur.getUTCMonth() + 1 });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Everything the contractor needs to decide whether to raise an invoice for
 * [start, end] inclusive. Read-only — raising the invoice is
 * `generateRangeContractorInvoice`, which recomputes from the same rules
 * inside a transaction rather than trusting anything echoed back from here.
 */
export async function previewContractorRangeInvoice(
  personId: string,
  start: Date,
  end: Date,
): Promise<ContractorRangePreview> {
  const endExclusive = addDays(end, 1);
  const blockers: string[] = [];

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { employment: true, rate: true },
  });

  const empty: ContractorRangePreview = {
    start,
    end,
    groups: [],
    pending: [],
    excludedExpenseCount: 0,
    rateNote: { ratesCents: [], usedFrozenRate: false, usedCurrentRate: false },
    totals: {
      hours: 0,
      feesExGstCents: 0,
      feesGstCents: 0,
      expenseTotalCents: 0,
      expenseGstCents: 0,
      amountTotalCents: 0,
    },
    blockers,
  };

  if (!person) {
    blockers.push('Person not found.');
    return empty;
  }
  if (person.employment !== 'contractor') {
    blockers.push(
      'Only contractors invoice Foundry — full-time staff are paid via the monthly pay run.',
    );
    return empty;
  }

  const currentRateCents = person.rate ?? 0;

  // Frozen rates for every month the window touches. A month with no period
  // row, or one that was reopened (snapshot cleared), has no frozen rate and
  // falls through to the current rate.
  const months = monthsInRange(start, endExclusive);
  const periods = await prisma.timesheetPeriod.findMany({
    where: {
      personId,
      OR: months.map((m) => ({ year: m.year, month: m.month })),
    },
    select: { year: true, month: true, draftRateCents: true },
  });
  const frozenByMonth = new Map<string, number>();
  for (const p of periods) {
    if (p.draftRateCents !== null && p.draftRateCents > 0) {
      frozenByMonth.set(`${p.year}-${p.month}`, p.draftRateCents);
    }
  }

  const entries = await prisma.timesheetEntry.findMany({
    where: { personId, date: { gte: start, lt: endExclusive } },
    select: {
      id: true,
      date: true,
      hours: true,
      status: true,
      contractorBillId: true,
      projectId: true,
      project: {
        select: {
          id: true,
          code: true,
          name: true,
          manager: { select: { firstName: true, lastName: true } },
          primaryPartner: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: [{ date: 'asc' }],
  });

  const groups = new Map<string, ContractorRangeGroup>();
  const pending = new Map<string, ContractorRangePending>();
  const ratesUsed = new Set<number>();
  let usedFrozenRate = false;
  let usedCurrentRate = false;

  const emptyGroup = (
    projectId: string,
    projectCode: string,
    projectName: string,
  ): ContractorRangeGroup => ({
    projectId,
    projectCode,
    projectName,
    hours: 0,
    feesExGstCents: 0,
    entryIds: [],
    expenseTotalCents: 0,
    expenseGstCents: 0,
    expenseIds: [],
  });

  for (const e of entries) {
    const hours = Number(e.hours);
    if (hours <= 0) continue;

    // Already consumed by a contractor bill — not billable again, and not
    // "pending" either. Nothing to show; the earlier invoice covers it.
    if (e.contractorBillId !== null) continue;

    if (e.status !== 'approved') {
      const key = `${e.projectId}:${e.status}`;
      const cur =
        pending.get(key) ??
        ({
          projectId: e.projectId,
          projectCode: e.project.code,
          projectName: e.project.name,
          hours: 0,
          status: e.status === 'draft' ? 'draft' : 'submitted',
          waitingOn: Array.from(
            new Set(
              [
                `${e.project.manager.firstName} ${e.project.manager.lastName}`,
                `${e.project.primaryPartner.firstName} ${e.project.primaryPartner.lastName}`,
              ].filter(Boolean),
            ),
          ),
        } satisfies ContractorRangePending);
      cur.hours += hours;
      pending.set(key, cur);
      continue;
    }

    const { rateCents, frozen } = resolveEntryRateCents(
      e.date,
      frozenByMonth,
      currentRateCents,
    );
    if (rateCents <= 0) continue;
    ratesUsed.add(rateCents);
    if (frozen) usedFrozenRate = true;
    else usedCurrentRate = true;

    const cur =
      groups.get(e.projectId) ??
      emptyGroup(e.projectId, e.project.code, e.project.name);
    cur.hours += hours;
    cur.feesExGstCents += Math.round(hours * rateCents);
    cur.entryIds.push(e.id);
    groups.set(e.projectId, cur);
  }

  if (currentRateCents <= 0 && !usedFrozenRate) {
    blockers.push(
      'No rate on file — an admin needs to set your rate before this can be invoiced.',
    );
  }

  // Pass-through expenses, on exactly the TASK-509 terms.
  const expenses = await prisma.expense.findMany({
    where: {
      personId,
      date: { gte: start, lt: endExclusive },
      status: 'approved',
      contractorBillId: null,
    },
    select: {
      id: true,
      amount: true,
      gst: true,
      projectId: true,
      project: { select: { id: true, code: true, name: true } },
    },
  });
  let excludedExpenseCount = 0;
  for (const x of expenses) {
    if (x.projectId === null || x.project === null) {
      // Untagged (OPEX): one Bill per project means there is nowhere for it
      // to land. Stays on the reimbursement path.
      excludedExpenseCount += 1;
      continue;
    }
    const cur =
      groups.get(x.projectId) ??
      emptyGroup(x.projectId, x.project.code, x.project.name);
    cur.expenseTotalCents += x.amount;
    cur.expenseGstCents += x.gst;
    cur.expenseIds.push(x.id);
    groups.set(x.projectId, cur);
  }

  const groupList = Array.from(groups.values()).sort((a, b) =>
    a.projectCode.localeCompare(b.projectCode),
  );

  let hours = 0;
  let feesExGstCents = 0;
  let feesGstCents = 0;
  let expenseTotalCents = 0;
  let expenseGstCents = 0;
  for (const g of groupList) {
    hours += g.hours;
    feesExGstCents += g.feesExGstCents;
    // GST rounded per bill, matching how each Bill is written.
    feesGstCents += Math.round(g.feesExGstCents * 0.1);
    expenseTotalCents += g.expenseTotalCents;
    expenseGstCents += g.expenseGstCents;
  }

  return {
    start,
    end,
    groups: groupList,
    pending: Array.from(pending.values()).sort((a, b) =>
      a.projectCode.localeCompare(b.projectCode),
    ),
    excludedExpenseCount,
    rateNote: {
      ratesCents: Array.from(ratesUsed).sort((a, b) => a - b),
      usedFrozenRate,
      usedCurrentRate,
    },
    totals: {
      hours,
      feesExGstCents,
      feesGstCents,
      expenseTotalCents,
      expenseGstCents,
      amountTotalCents: feesExGstCents + feesGstCents + expenseTotalCents,
    },
    blockers,
  };
}

/**
 * Close any `approved` period whose hours have all been billed.
 *
 * The admin out-of-cycle path (/directory/people/[id]/draft-bill) bills by
 * person, not by period, so without this a month could end up fully billed
 * yet stuck at `approved` forever — showing the contractor an invoice
 * prompt for hours that are already on a bill. Called after that path runs
 * so both routes leave the same state behind.
 */
export async function markPeriodsInvoicedIfFullyBilled(
  tx: Prisma.TransactionClient,
  personId: string,
  months: MonthKey[],
  now: Date,
): Promise<void> {
  for (const { year, month } of months) {
    const period = await tx.timesheetPeriod.findUnique({
      where: { personId_year_month: { personId, year, month } },
      select: { id: true, state: true },
    });
    if (!period || period.state !== 'approved') continue;

    const start = monthStartFrom(year, month);
    const end = addDays(start, daysInMonth(year, month));
    const unbilled = await tx.timesheetEntry.count({
      where: { personId, date: { gte: start, lt: end }, contractorBillId: null },
    });
    if (unbilled > 0) continue;

    await tx.timesheetPeriod.update({
      where: { id: period.id },
      data: { state: 'invoiced', invoicedAt: now },
    });
  }
}
