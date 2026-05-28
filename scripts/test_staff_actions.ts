import { prisma } from '@/server/db';
import { listStaffPendingActions } from '@/server/staff-actions';

async function main() {
  const staff = await prisma.person.findFirst({
    where: { roles: { has: 'staff' }, inactiveAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!staff) { console.log('No staff'); return; }
  const pending = await listStaffPendingActions(staff.id);
  console.log(`\n=== ${staff.firstName} ${staff.lastName} — ${pending.length} pending ===`);
  for (const p of pending) {
    console.log(`  [${p.tone}] ${p.kind}`);
    console.log(`    ${p.title}`);
    console.log(`    ${p.detail}`);
    console.log(`    → ${p.href}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
