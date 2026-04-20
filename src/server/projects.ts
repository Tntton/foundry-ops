import type { ProjectStage } from '@prisma/client';
import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';

export type ProjectListRow = {
  id: string;
  code: string;
  name: string;
  stage: ProjectStage;
  client: { id: string; code: string; legalName: string };
  primaryPartner: { id: string; initials: string; firstName: string; lastName: string };
  manager: { id: string; initials: string; firstName: string; lastName: string };
  contractValueCents: number;
  startDate: Date;
  endDate: Date;
};

export type ProjectListFilter = {
  stage?: ProjectStage;
  clientId?: string;
  partnerId?: string;
  active?: boolean;
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

  const where: Record<string, unknown> = {
    ...(filter.stage ? { stage: filter.stage } : {}),
    ...(filter.clientId ? { clientId: filter.clientId } : {}),
    ...(filter.partnerId ? { primaryPartnerId: filter.partnerId } : {}),
    ...(filter.active === true ? { stage: { not: 'archived' } } : {}),
    ...(filter.active === false ? { stage: 'archived' } : {}),
    ...(scopeFilter.length > 0 ? { AND: scopeFilter } : {}),
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
      startDate: true,
      endDate: true,
      client: { select: { id: true, code: true, legalName: true } },
      primaryPartner: { select: { id: true, initials: true, firstName: true, lastName: true } },
      manager: { select: { id: true, initials: true, firstName: true, lastName: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    stage: r.stage,
    client: r.client,
    primaryPartner: r.primaryPartner,
    manager: r.manager,
    contractValueCents: r.contractValue,
    startDate: r.startDate,
    endDate: r.endDate,
  }));
}

export async function listActivePeopleOptions() {
  return prisma.person.findMany({
    where: { endDate: null },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: { id: true, initials: true, firstName: true, lastName: true, band: true },
  });
}

export async function listClientOptions() {
  return prisma.client.findMany({
    orderBy: { code: 'asc' },
    select: { id: true, code: true, legalName: true },
  });
}
