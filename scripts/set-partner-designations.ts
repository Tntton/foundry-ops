/**
 * Set the `isFullPartner` flag for the three full partners (TT,
 * Michael Bonning, Chris Parker). All others with role=partner stay as
 * Associate Partners. Jas Navarro is also surfaced here as a sanity
 * check on her admin/office-manager role assignment.
 *
 * Run: pnpm tsx scripts/set-partner-designations.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FULL_PARTNERS: Array<{ email: string; label: string }> = [
  { email: 'trung@foundry.health', label: 'Trung Ton' },
  { email: 'michael@foundry.health', label: 'Michael Bonning' },
  { email: 'chris@foundry.health', label: 'Christopher Parker' },
];

const ADMIN_OFFICE_MANAGER = 'jas@foundry.health'; // Jas Navarro

async function main() {
  // Reset everyone's full-partner flag so a re-run trims any stragglers
  // who shouldn't be flagged anymore.
  const reset = await prisma.person.updateMany({
    where: { isFullPartner: true },
    data: { isFullPartner: false },
  });
  console.log(`reset: cleared isFullPartner on ${reset.count} existing rows`);

  for (const fp of FULL_PARTNERS) {
    const existing = await prisma.person.findUnique({
      where: { email: fp.email },
      select: { id: true, firstName: true, lastName: true, roles: true, band: true },
    });
    if (!existing) {
      console.warn(`skip: no Person with email ${fp.email} (${fp.label})`);
      continue;
    }
    // Make sure they have role=partner too (idempotent — only adds if missing).
    const nextRoles = existing.roles.includes('partner')
      ? existing.roles
      : [...existing.roles, 'partner'];
    const updated = await prisma.person.update({
      where: { id: existing.id },
      data: { isFullPartner: true, roles: nextRoles },
      select: { firstName: true, lastName: true, isFullPartner: true, band: true, roles: true },
    });
    console.log(
      `set: ${updated.firstName} ${updated.lastName} → isFullPartner=${updated.isFullPartner}, band=${updated.band}, roles=[${updated.roles.join(',')}]`,
    );
  }

  // Sanity-check the office manager — log a warning if she doesn't
  // already have the admin role assigned. Doesn't auto-set; admin role
  // is a privilege bump and should be done deliberately.
  const om = await prisma.person.findUnique({
    where: { email: ADMIN_OFFICE_MANAGER },
    select: { firstName: true, lastName: true, roles: true, band: true },
  });
  if (om) {
    const hasAdmin = om.roles.includes('admin') || om.roles.includes('super_admin');
    console.log(
      `\noffice manager: ${om.firstName} ${om.lastName} · band=${om.band} · roles=[${om.roles.join(',')}]${
        hasAdmin ? '' : ' ⚠ no admin role'
      }`,
    );
  } else {
    console.warn(`\nskip: no Person with email ${ADMIN_OFFICE_MANAGER}`);
  }

  // Surface the AP roster so the user can verify.
  const aps = await prisma.person.findMany({
    where: {
      roles: { has: 'partner' },
      isFullPartner: false,
      endDate: null,
    },
    orderBy: { lastName: 'asc' },
    select: { firstName: true, lastName: true, band: true, email: true },
  });
  console.log(`\nassociate partners (${aps.length}):`);
  for (const p of aps) {
    console.log(`  · ${p.firstName} ${p.lastName} · ${p.band} · ${p.email}`);
  }

  const fps = await prisma.person.findMany({
    where: { isFullPartner: true },
    orderBy: { lastName: 'asc' },
    select: { firstName: true, lastName: true, band: true, email: true },
  });
  console.log(`\nfull partners (${fps.length}):`);
  for (const p of fps) {
    console.log(`  · ${p.firstName} ${p.lastName} · ${p.band} · ${p.email}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
