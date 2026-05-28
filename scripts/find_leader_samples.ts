import { prisma } from '@/server/db';

async function main() {
  for (const role of ['manager', 'partner', 'admin', 'super_admin'] as const) {
    const people = await prisma.person.findMany({
      where: { roles: { has: role }, inactiveAt: null },
      select: {
        id: true, firstName: true, lastName: true, email: true, roles: true,
        primaryPartnerOfProjects: { select: { code: true, name: true, stage: true } },
        managerOfProjects: { select: { code: true, name: true, stage: true } },
      },
      take: 3,
    });
    console.log(`\n=== ${role} (${people.length}) ===`);
    for (const p of people) {
      const leads = [
        ...p.primaryPartnerOfProjects.map(x => `partner: ${x.code}`),
        ...p.managerOfProjects.map(x => `manager: ${x.code}`),
      ];
      console.log(`  ${p.firstName} ${p.lastName} (${p.email}) [${p.roles.join(',')}]`);
      console.log(`    leads: ${leads.join(', ') || 'none'}`);
    }
  }

  // Approval queue depth — what would a leader actually see?
  const pendingApprovals = await prisma.approval.groupBy({
    by: ['subjectType', 'requiredRole'],
    where: { status: 'pending' },
    _count: { _all: true },
  });
  console.log(`\n=== Pending approvals by type × required role ===`);
  for (const p of pendingApprovals) console.log(`  ${p.subjectType} / ${p.requiredRole}: ${p._count._all}`);

  // Pending timesheet entries needing approval
  const tsPending = await prisma.timesheetEntry.count({ where: { status: 'submitted' } });
  console.log(`\nTimesheets pending approval: ${tsPending}`);

  // Open risks
  const openRisks = await prisma.risk.count({ where: { status: { not: 'closed' } } });
  console.log(`Open risks across firm: ${openRisks}`);

  // Open deals
  const openDeals = await prisma.deal.count({ where: { stage: { in: ['lead', 'qualifying', 'proposal', 'negotiation'] }, archivedAt: null } });
  console.log(`Open BD deals: ${openDeals}`);

  // Stale projects (no activity in N days)
  const projects = await prisma.project.count({ where: { stage: { in: ['kickoff', 'delivery'] } } });
  console.log(`Active projects: ${projects}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
