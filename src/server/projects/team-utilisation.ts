import { prisma } from '@/server/db';

export type ProjectTeamUtilisationRow = {
  personId: string;
  initials: string;
  firstName: string;
  lastName: string;
  roleOnProject: string | null; // from ProjectTeam; null if person logged time without being on the team
  allocationPct: number | null; // 0-100 from ProjectTeam; null when not on roster
  onTeam: boolean;
  billableRateCents: number | null;
  costRateCents: number;
  hoursApproved: number;
  hoursBilled: number;
  billableValueCents: number; // hours × billRate
  costValueCents: number; // hours × costRate
  marginCents: number;
};

export type ProjectTeamUtilisation = {
  projectId: string;
  rows: ProjectTeamUtilisationRow[];
  totals: {
    hoursApproved: number;
    hoursBilled: number;
    billableValueCents: number;
    costValueCents: number;
    marginCents: number;
    ghostHours: number; // hours logged by people not on the project team
  };
};

/**
 * Who's actually spending time on a project vs who's on the roster.
 *   - Roster-only people (0 hours) still appear so PMs can see who hasn't
 *     logged yet.
 *   - Time-logged-but-not-on-roster people show onTeam=false ("ghost"
 *     contributors) so PMs can either add them to the team or challenge
 *     the entries.
 */
export async function computeProjectTeamUtilisation(
  projectId: string,
): Promise<ProjectTeamUtilisation> {
  const [teamRows, timeEntries] = await Promise.all([
    prisma.projectTeam.findMany({
      where: { projectId },
      include: {
        person: {
          select: {
            id: true,
            initials: true,
            firstName: true,
            lastName: true,
            rate: true,
            billRate: true,
          },
        },
      },
    }),
    prisma.timesheetEntry.findMany({
      where: {
        projectId,
        status: { in: ['approved', 'billed'] },
      },
      select: {
        hours: true,
        personId: true,
        billedInvoiceId: true,
      },
    }),
  ]);

  // Aggregate hours per person.
  const hoursByPerson = new Map<string, { approved: number; billed: number }>();
  for (const e of timeEntries) {
    const cur = hoursByPerson.get(e.personId) ?? { approved: 0, billed: 0 };
    const h = Number(e.hours);
    cur.approved += h;
    if (e.billedInvoiceId) cur.billed += h;
    hoursByPerson.set(e.personId, cur);
  }

  // Seed rows for everyone on the team roster first.
  const byPerson = new Map<string, ProjectTeamUtilisationRow>();
  for (const t of teamRows) {
    const h = hoursByPerson.get(t.personId) ?? { approved: 0, billed: 0 };
    const billRate = t.person.billRate ?? null;
    const costRate = t.person.rate;
    byPerson.set(t.personId, {
      personId: t.personId,
      initials: t.person.initials,
      firstName: t.person.firstName,
      lastName: t.person.lastName,
      roleOnProject: t.roleOnProject,
      allocationPct: t.allocationPct,
      onTeam: true,
      billableRateCents: billRate,
      costRateCents: costRate,
      hoursApproved: h.approved,
      hoursBilled: h.billed,
      billableValueCents: Math.round(h.approved * (billRate ?? 0)),
      costValueCents: Math.round(h.approved * costRate),
      marginCents: Math.round(h.approved * ((billRate ?? 0) - costRate)),
    });
  }

  // Then pick up any "ghost" contributors who logged but aren't on the roster.
  const ghostIds = [...hoursByPerson.keys()].filter((id) => !byPerson.has(id));
  if (ghostIds.length > 0) {
    const ghostPeople = await prisma.person.findMany({
      where: { id: { in: ghostIds } },
      select: {
        id: true,
        initials: true,
        firstName: true,
        lastName: true,
        rate: true,
        billRate: true,
      },
    });
    for (const p of ghostPeople) {
      const h = hoursByPerson.get(p.id) ?? { approved: 0, billed: 0 };
      const billRate = p.billRate ?? null;
      const costRate = p.rate;
      byPerson.set(p.id, {
        personId: p.id,
        initials: p.initials,
        firstName: p.firstName,
        lastName: p.lastName,
        roleOnProject: null,
        allocationPct: null,
        onTeam: false,
        billableRateCents: billRate,
        costRateCents: costRate,
        hoursApproved: h.approved,
        hoursBilled: h.billed,
        billableValueCents: Math.round(h.approved * (billRate ?? 0)),
        costValueCents: Math.round(h.approved * costRate),
        marginCents: Math.round(h.approved * ((billRate ?? 0) - costRate)),
      });
    }
  }

  const rows = [...byPerson.values()].sort((a, b) => {
    // Sort: on-roster with hours first (by hours desc), then roster-no-hours,
    // then ghosts (by hours desc).
    if (a.onTeam !== b.onTeam) return a.onTeam ? -1 : 1;
    return b.hoursApproved - a.hoursApproved;
  });

  const totals = rows.reduce(
    (acc, r) => ({
      hoursApproved: acc.hoursApproved + r.hoursApproved,
      hoursBilled: acc.hoursBilled + r.hoursBilled,
      billableValueCents: acc.billableValueCents + r.billableValueCents,
      costValueCents: acc.costValueCents + r.costValueCents,
      marginCents: acc.marginCents + r.marginCents,
      ghostHours: acc.ghostHours + (r.onTeam ? 0 : r.hoursApproved),
    }),
    {
      hoursApproved: 0,
      hoursBilled: 0,
      billableValueCents: 0,
      costValueCents: 0,
      marginCents: 0,
      ghostHours: 0,
    },
  );

  return { projectId, rows, totals };
}
