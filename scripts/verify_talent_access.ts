import { prisma } from '@/server/db';
import { hasCapability } from '@/server/capabilities';
import { filterNavForRoles } from '@/components/shell/nav-config';

const CHECK_ROLES = ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'] as const;

async function main() {
  // 1. Capability table
  console.log('\n=== `recruit.manage` capability ===');
  for (const r of CHECK_ROLES) {
    const ok = hasCapability({ person: { id: 'test', roles: [r] } } as never, 'recruit.manage');
    console.log(`  ${ok ? '✓' : '✗'} ${r}`);
  }

  // 2. Nav visibility for each role
  console.log('\n=== Nav: "Talent pipeline" visible for ===');
  for (const r of CHECK_ROLES) {
    const nav = filterNavForRoles([r]);
    const visible = nav.flatMap((g) => g.items).some((i) => i.href === '/talent');
    console.log(`  ${visible ? '✓' : '✗'} ${r}`);
  }

  // 3. Owner picker — count managers eligible
  const managers = await prisma.person.findMany({
    where: { inactiveAt: null, roles: { has: 'manager' } },
    select: { firstName: true, lastName: true },
  });
  console.log(`\n=== Managers now eligible as recruit owners (${managers.length}) ===`);
  for (const m of managers) console.log(`  ● ${m.firstName} ${m.lastName}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
