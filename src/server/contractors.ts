import { prisma } from '@/server/db';

export type ContractorProjectSummary = {
  id: string;
  code: string;
  name: string;
  stage: string;
  hours: number;
};

export type ContractorListRow = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
  email: string;
  level: string;
  region: string;
  fte: number;
  active: boolean;
  hasXeroContact: boolean;
  hoursLogged: number; // approved + billed timesheet hours, across all projects
  timesheetCostCents: number; // hours × current Person.rate
  billsPaidCents: number; // sum of Bill.amountTotal for approved+ bills where supplierPersonId = them
  billCount: number;
  projects: ContractorProjectSummary[];
};

/**
 * Per-contractor analytics — hours logged, cost to company, bills paid to them.
 * Timesheet cost uses the current Person.rate (not rate-card as-of-date) for
 * MVP. Bills total is ex-nothing (gross, inc GST) since that's what's paid.
 */
export async function listContractors(): Promise<ContractorListRow[]> {
  const contractors = await prisma.person.findMany({
    where: { employment: 'contractor' },
    orderBy: [{ endDate: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      initials: true,
      firstName: true,
      lastName: true,
      email: true,
      level: true,
      region: true,
      fte: true,
      endDate: true,
      rate: true,
      xeroContactId: true,
    },
  });
  if (contractors.length === 0) return [];

  const personIds = contractors.map((p) => p.id);

  const [timesheetAgg, billAgg, projectMemberships] = await Promise.all([
    prisma.timesheetEntry.groupBy({
      by: ['personId', 'projectId'],
      where: {
        personId: { in: personIds },
        status: { in: ['approved', 'billed'] },
      },
      _sum: { hours: true },
    }),
    prisma.bill.groupBy({
      by: ['supplierPersonId'],
      where: {
        supplierPersonId: { in: personIds },
        status: { in: ['approved', 'scheduled_for_payment', 'paid'] },
      },
      _sum: { amountTotal: true },
      _count: { _all: true },
    }),
    prisma.projectTeam.findMany({
      where: { personId: { in: personIds } },
      select: {
        personId: true,
        project: { select: { id: true, code: true, name: true, stage: true } },
      },
    }),
  ]);

  const projectIds = new Set<string>();
  for (const row of timesheetAgg) projectIds.add(row.projectId);
  for (const m of projectMemberships) projectIds.add(m.project.id);
  const projectRows =
    projectIds.size > 0
      ? await prisma.project.findMany({
          where: { id: { in: [...projectIds] } },
          select: { id: true, code: true, name: true, stage: true },
        })
      : [];
  const projectById = new Map(projectRows.map((p) => [p.id, p]));

  return contractors.map((c) => {
    const myTimesheet = timesheetAgg.filter((t) => t.personId === c.id);
    const hoursLogged = myTimesheet.reduce((s, t) => s + Number(t._sum.hours ?? 0), 0);
    const timesheetCost = Math.round(hoursLogged * (c.rate ?? 0));
    const myBills = billAgg.find((b) => b.supplierPersonId === c.id);
    const billsPaid = myBills?._sum.amountTotal ?? 0;
    const billCount = myBills?._count._all ?? 0;

    // Combine timesheet projects (they logged hours) with team memberships (they're on the roster).
    const projectSet = new Map<string, ContractorProjectSummary>();
    for (const t of myTimesheet) {
      const p = projectById.get(t.projectId);
      if (!p) continue;
      projectSet.set(p.id, {
        id: p.id,
        code: p.code,
        name: p.name,
        stage: p.stage,
        hours: Number(t._sum.hours ?? 0),
      });
    }
    for (const m of projectMemberships.filter((m) => m.personId === c.id)) {
      if (!projectSet.has(m.project.id)) {
        projectSet.set(m.project.id, {
          id: m.project.id,
          code: m.project.code,
          name: m.project.name,
          stage: m.project.stage,
          hours: 0,
        });
      }
    }
    const projects = [...projectSet.values()].sort((a, b) => a.code.localeCompare(b.code));

    return {
      id: c.id,
      initials: c.initials,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      level: c.level,
      region: c.region,
      fte: Number(c.fte),
      active: c.endDate === null,
      hasXeroContact: Boolean(c.xeroContactId),
      hoursLogged,
      timesheetCostCents: timesheetCost,
      billsPaidCents: billsPaid,
      billCount,
      projects,
    };
  });
}
