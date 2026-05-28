import { prisma } from '@/server/db';
async function main() {
  const counts = await prisma.bill.groupBy({
    by: ['projectId'],
    _count: { _all: true },
  });
  const projectsById = new Map(
    (await prisma.project.findMany({ select: { id: true, code: true } })).map(
      (p) => [p.id, p.code],
    ),
  );
  console.log('Bills by project code:');
  for (const c of counts) {
    const code = c.projectId ? projectsById.get(c.projectId) ?? '?' : 'OPEX (null)';
    console.log(`  ${code}: ${c._count._all}`);
  }
  const expCounts = await prisma.expense.groupBy({
    by: ['projectId'],
    _count: { _all: true },
  });
  console.log('\nExpenses by project code:');
  for (const c of expCounts) {
    const code = c.projectId ? projectsById.get(c.projectId) ?? '?' : 'OPEX (null)';
    console.log(`  ${code}: ${c._count._all}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
