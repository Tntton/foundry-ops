import { prisma } from '@/server/db';

async function main() {
  // Find a staff person to test as
  const staff = await prisma.person.findMany({
    where: { roles: { has: 'staff' }, inactiveAt: null },
    select: {
      id: true, firstName: true, lastName: true, email: true,
      band: true, level: true, roles: true,
      projectTeamMemberships: { select: { project: { select: { code: true, name: true, stage: true } } } },
    },
    take: 5,
  });
  console.log(`\n=== Staff members (${staff.length}) ===`);
  for (const s of staff) {
    console.log(`  ${s.firstName} ${s.lastName} (${s.email}) · ${s.band ?? '-'}/${s.level ?? '-'} · roles=${s.roles.join(',')}`);
    console.log(`    on projects: ${s.projectTeamMemberships.map(m => m.project.code).join(', ') || 'none'}`);
  }

  // Sample staff workload
  const sample = staff[0];
  if (!sample) { console.log('No staff found'); return; }

  const recentTimesheets = await prisma.timesheetEntry.findMany({
    where: { personId: sample.id },
    orderBy: { date: 'desc' },
    take: 10,
    select: { date: true, hours: true, status: true, project: { select: { code: true } } },
  });
  console.log(`\n=== ${sample.firstName}'s recent timesheets (${recentTimesheets.length}) ===`);
  for (const t of recentTimesheets) console.log(`  ${t.date.toISOString().slice(0,10)} ${t.project.code} ${t.hours}h [${t.status}]`);

  const expenses = await prisma.expense.findMany({
    where: { personId: sample.id },
    orderBy: { date: 'desc' },
    take: 10,
    select: { date: true, vendor: true, amount: true, status: true, category: true },
  });
  console.log(`\n=== ${sample.firstName}'s recent expenses (${expenses.length}) ===`);
  for (const e of expenses) console.log(`  ${e.date.toISOString().slice(0,10)} ${e.vendor} $${(e.amount/100).toFixed(2)} [${e.status}] ${e.category}`);

  // Updates feed
  const updates = await prisma.userUpdate.findMany({
    where: { personId: sample.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { kind: true, title: true, readAt: true, createdAt: true },
  });
  console.log(`\n=== ${sample.firstName}'s recent updates feed (${updates.length}) ===`);
  for (const u of updates) console.log(`  ${u.readAt ? '✓' : '●'} ${u.createdAt.toISOString().slice(0,10)} [${u.kind}] ${u.title}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
