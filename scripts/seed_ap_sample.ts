import { prisma } from '@/server/db';

async function main() {
  // Seed one Associate Partner sample so the new role/band can be
  // exercised in the dashboard + nav + project pickers. We pick an
  // existing staff person to "promote" — Sandbox Tester — and flip
  // their band/level/role to AP. If a real AP is already in the
  // table, this is a no-op.
  const existing = await prisma.person.findFirst({
    where: { roles: { has: 'associate_partner' }, inactiveAt: null },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (existing) {
    console.log(`Already have an AP: ${existing.firstName} ${existing.lastName} (${existing.email})`);
    return;
  }

  // Pick a target — first Sandbox Tester, else first staff member.
  const target =
    (await prisma.person.findFirst({
      where: { firstName: 'Sandbox', inactiveAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, band: true, level: true, roles: true },
    })) ??
    (await prisma.person.findFirst({
      where: { roles: { has: 'staff' }, inactiveAt: null },
      orderBy: { firstName: 'asc' },
      select: { id: true, firstName: true, lastName: true, email: true, band: true, level: true, roles: true },
    }));
  if (!target) { console.log('No candidate found to promote.'); return; }

  console.log(`Promoting ${target.firstName} ${target.lastName} → Associate Partner`);
  console.log(`  Before: band=${target.band}, level=${target.level}, roles=${target.roles.join(',')}`);

  await prisma.person.update({
    where: { id: target.id },
    data: {
      band: 'Associate_Partner',
      level: 'L3',
      roles: ['associate_partner'],
      fte: null, // leadership tier — variable capacity
    },
  });

  const updated = await prisma.person.findUnique({
    where: { id: target.id },
    select: { firstName: true, lastName: true, email: true, band: true, level: true, roles: true },
  });
  console.log(`  After: band=${updated?.band}, level=${updated?.level}, roles=${updated?.roles.join(',')}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
