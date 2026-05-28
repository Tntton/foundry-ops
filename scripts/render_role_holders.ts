import { prisma } from '@/server/db';
import type { Role } from '@prisma/client';

const ROLES: readonly Role[] = ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'];
const LABEL: Record<Role, string> = {
  super_admin: 'Super-admin',
  admin: 'Admin',
  partner: 'Partner',
  associate_partner: 'Associate Partner',
  manager: 'Manager',
  staff: 'Staff',
};

async function main() {
  const people = await prisma.person.findMany({
    where: { inactiveAt: null },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: { firstName: true, lastName: true, band: true, level: true, roles: true, email: true },
  });

  console.log('\n=== Current role holders ===\n');
  for (const role of ROLES) {
    const holders = people.filter((p) => p.roles.includes(role));
    console.log(`[${LABEL[role]}] · ${holders.length} ${holders.length === 1 ? 'person' : 'people'}`);
    if (holders.length === 0) {
      console.log('  —');
    } else {
      for (const p of holders) {
        console.log(`  ${p.firstName} ${p.lastName} (${p.band ?? '-'}/${p.level ?? '-'}) · ${p.email}`);
      }
    }
    console.log('');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
