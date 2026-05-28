import { prisma } from '@/server/db';
import { listStaffPendingActions } from '@/server/staff-actions';

async function main() {
  const staff = await prisma.person.findFirst({
    where: { roles: { has: 'staff' }, inactiveAt: null, email: 'simone@foundry.health' },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!staff) { console.log('No Simone'); return; }

  // Inject one DRAFT expense to verify the dashboard catches it.
  const fhx = await prisma.project.findFirst({ where: { code: 'FHX000' }, select: { id: true } });
  const draftId = `qa-test-draft-${Date.now()}`;
  await prisma.expense.create({
    data: {
      id: draftId,
      personId: staff.id,
      projectId: null,
      date: new Date(),
      amount: 4500,
      gst: 410,
      vendor: 'Test Café',
      category: 'meals',
      description: 'QA smoke — draft state for dashboard test',
      status: 'draft',
    },
  });

  const pending = await listStaffPendingActions(staff.id);
  console.log(`\n=== ${staff.firstName}'s pending actions (${pending.length}) ===`);
  for (const p of pending) {
    console.log(`  [${p.tone}] ${p.title} → ${p.href}`);
    console.log(`    ${p.detail}`);
  }

  // Clean up
  await prisma.expense.delete({ where: { id: draftId } });
  console.log('\n(cleaned up test row)');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
