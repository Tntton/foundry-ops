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
  description: string;
  status: 'draft' | 'submitted' | 'approved' | 'billed' | 'mixed';
  cells: TimesheetCell[];
};

export async function getWeekForPerson(
  personId: string,
  weekStart: Date,
): Promise<TimesheetRow[]> {
  const weekEnd = addDays(weekStart, 7);

  const [entries, assignments] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: {
        personId,
        date: { gte: weekStart, lt: weekEnd },
      },
      include: {
        project: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.projectTeam.findMany({
      where: {
        personId,
        project: { stage: { not: 'archived' } },
      },
      include: { project: { select: { id: true, code: true, name: true } } },
    }),
  ]);

  type ProjectMini = { id: string; code: string; name: string };
  const projectsMap = new Map<string, ProjectMini>();
  for (const a of assignments) projectsMap.set(a.project.id, a.project);
  for (const e of entries) projectsMap.set(e.project.id, e.project);

  return Array.from(projectsMap.values())
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => {
      const projectEntries = entries.filter((e) => e.projectId === p.id);
      const cells: TimesheetCell[] = Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
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
      person: { select: { id: true, initials: true, firstName: true, lastName: true } },
      project: { select: { id: true, code: true, name: true, managerId: true } },
    },
  });
  return entries;
}
