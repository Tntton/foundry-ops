import type { ProjectStage } from '@prisma/client';
import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';

export type ProjectListRow = {
  id: string;
  code: string;
  name: string;
  stage: ProjectStage;
  client: { id: string; code: string; legalName: string };
  primaryPartner: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  };
  manager: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  };
  team: Array<{
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  }>;
  contractValueCents: number;
  startDate: Date | null;
  endDate: Date | null;
  actualEndDate: Date | null;
  // Within-column priority rank on the kanban (1..N). 0 = unranked /
  // freshly created; kanban surfaces sort those to the bottom of the
  // column. See `reorderProjectsInStage`.
  sortOrder: number;
  // QC traffic-light derived from open risks (high → red, any → amber, none → green)
  qcStatus: 'green' | 'amber' | 'red';
};

/**
 * Display labels for stages — the kanban shows pipeline language, not raw
 * enum values. Matches the buckets on the projects board: Setup → Active →
 * Wrapping → Closed.
 */
export const STAGE_LABEL: Record<ProjectStage, string> = {
  kickoff: 'Setup',
  delivery: 'Active',
  closing: 'Wrapping',
  archived: 'Closed',
  // Internal-only lanes (FHP series) — see kanban band split.
  standing: 'Standing',
  benched: 'Benched',
};

export const STAGE_HINT: Record<ProjectStage, string> = {
  kickoff: 'contract · team · code',
  delivery: 'in delivery',
  closing: 'final weeks · invoicing',
  archived: 'paid · reconciled',
  standing: 'ongoing · always on',
  benched: 'paused · may return',
};

export const PIPELINE_ORDER: ProjectStage[] = [
  'kickoff',
  'delivery',
  'closing',
  'archived',
  'standing',
  'benched',
];

export type ProjectListFilter = {
  stage?: ProjectStage;
  clientId?: string;
  partnerId?: string;
  active?: boolean;
  search?: string;
};

/**
 * Role-scoped project list:
 *  - super_admin / admin / partner: see everything
 *  - manager: projects where managerId === self
 *  - staff: projects where team includes self
 */
export async function listProjects(
  session: Session,
  filter: ProjectListFilter = {},
): Promise<ProjectListRow[]> {
  const personId = session.person.id;
  const roles = session.person.roles;

  const scopeFilter: Record<string, unknown>[] = [];
  if (!roles.some((r) => r === 'super_admin' || r === 'admin' || r === 'partner')) {
    if (roles.includes('manager')) {
      scopeFilter.push({ managerId: personId });
    } else {
      // Staff: on the team.
      scopeFilter.push({ team: { some: { personId } } });
    }
  }

  const q = filter.search?.trim();
  const searchFilter = q
    ? {
        OR: [
          { code: { contains: q, mode: 'insensitive' as const } },
          { name: { contains: q, mode: 'insensitive' as const } },
          { client: { is: { code: { contains: q, mode: 'insensitive' as const } } } },
          { client: { is: { legalName: { contains: q, mode: 'insensitive' as const } } } },
        ],
      }
    : null;

  // Hide the firm-overhead expense buckets (FHO000 / FHX000) from the
  // projects list / kanban / grid / table — they exist as Project rows
  // so expenses can be tagged against them, but they aren't projects in
  // the working sense and shouldn't pollute the project surfaces. Real
  // internal FH projects (FHP000, FHP001+) still show.
  const BUCKET_CODES = ['FHO000', 'FHX000'];

  const where: Record<string, unknown> = {
    ...(filter.stage ? { stage: filter.stage } : {}),
    ...(filter.clientId ? { clientId: filter.clientId } : {}),
    ...(filter.partnerId ? { primaryPartnerId: filter.partnerId } : {}),
    ...(filter.active === true ? { stage: { not: 'archived' } } : {}),
    ...(filter.active === false ? { stage: 'archived' } : {}),
    ...(scopeFilter.length > 0 ? { AND: scopeFilter } : {}),
    ...(searchFilter ? searchFilter : {}),
    code: { notIn: BUCKET_CODES },
  };

  const rows = await prisma.project.findMany({
    where,
    orderBy: [{ stage: 'asc' }, { code: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      stage: true,
      contractValue: true,
      sortOrder: true,
      startDate: true,
      endDate: true,
      actualEndDate: true,
      client: { select: { id: true, code: true, legalName: true } },
      primaryPartner: { select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true } },
      manager: { select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true } },
      team: {
        select: {
          person: {
            select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
          },
        },
      },
      risks: {
        where: { status: { in: ['open', 'mitigating'] } },
        select: { severity: true },
      },
    },
  });

  return rows.map<ProjectListRow>((r) => {
    const hasHigh = r.risks.some((rk) => rk.severity === 'high');
    const hasAny = r.risks.length > 0;
    const qcStatus: ProjectListRow['qcStatus'] = hasHigh
      ? 'red'
      : hasAny
        ? 'amber'
        : 'green';
    // De-dupe people across (manager, partner, team) for the avatar stack.
    const teamMap = new Map<string, ProjectListRow['team'][number]>();
    for (const t of r.team) {
      teamMap.set(t.person.id, t.person);
    }
    teamMap.set(r.primaryPartner.id, r.primaryPartner);
    teamMap.set(r.manager.id, r.manager);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      stage: r.stage,
      client: r.client,
      primaryPartner: r.primaryPartner,
      manager: r.manager,
      team: Array.from(teamMap.values()),
      contractValueCents: r.contractValue,
      sortOrder: r.sortOrder,
      startDate: r.startDate,
      endDate: r.endDate,
      actualEndDate: r.actualEndDate,
      qcStatus,
    };
  });
}

export async function listActivePeopleOptions() {
  return prisma.person.findMany({
    where: { endDate: null },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true, band: true },
  });
}

export async function listClientOptions() {
  return prisma.client.findMany({
    orderBy: { code: 'asc' },
    select: { id: true, code: true, legalName: true },
  });
}
