/**
 * Ensure Jas Navarro holds full admin access (super_admin + admin).
 *
 * Runtime access is gated on Person.roles (see src/server/auth.ts jwt
 * callback + session.ts). The seed already maps JN → [super_admin, admin],
 * but a Person row created on first sign-in starts with roles=[] until it is
 * patched — this script makes the grant explicit and idempotent against
 * whatever DB the connection points at.
 *
 * Dry-run by default (read-only). Pass --apply to write the change.
 * Writes an AuditEvent per A9 (actor = the operator, resolved by --actor
 * email, default trung@foundry.health).
 *
 *   npx tsx --env-file=.env.local scripts/grant_jas_admin.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/grant_jas_admin.ts --apply
 */
import { PrismaClient, type Role } from '@prisma/client';
import { writeAudit } from '../src/server/audit';

const prisma = new PrismaClient();

const TARGET_EMAIL = 'jas.navarro@foundry.health';
const REQUIRED: Role[] = ['super_admin', 'admin'];

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const actorEmail = (argValue('--actor') ?? 'trung@foundry.health').toLowerCase();

  const jas = await prisma.person.findFirst({
    where: {
      OR: [
        { email: { equals: TARGET_EMAIL, mode: 'insensitive' } },
        { initials: 'JN', lastName: { equals: 'Navarro', mode: 'insensitive' } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, email: true, roles: true, inactiveAt: true },
  });

  if (!jas) {
    console.error(`No Person found for ${TARGET_EMAIL} (or initials JN / Navarro). Nothing to do.`);
    process.exitCode = 1;
    return;
  }

  const before = jas.roles;
  const nextRoles = Array.from(new Set<Role>([...before, ...REQUIRED]));
  const missing = REQUIRED.filter((r) => !before.includes(r));

  console.log(`Target: ${jas.firstName} ${jas.lastName} <${jas.email}> (${jas.id})`);
  console.log(`  current roles: [${before.join(', ') || '(none)'}]`);
  if (jas.inactiveAt) console.log(`  ⚠️  profile is INACTIVE (inactiveAt=${jas.inactiveAt.toISOString()})`);

  if (missing.length === 0) {
    console.log('  ✓ Already holds super_admin + admin — no change needed.');
    return;
  }

  console.log(`  missing: [${missing.join(', ')}] → will set [${nextRoles.join(', ')}]`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write this change.');
    return;
  }

  const actor = await prisma.person.findUnique({
    where: { email: actorEmail },
    select: { id: true },
  });
  if (!actor) {
    console.error(`Actor ${actorEmail} not found — cannot attribute the audit event. Aborting.`);
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.person.update({ where: { id: jas.id }, data: { roles: nextRoles } });
    await writeAudit(tx, {
      actor: { type: 'person', id: actor.id },
      action: 'updated',
      entity: {
        type: 'person',
        id: jas.id,
        before: { roles: before },
        after: { roles: nextRoles },
      },
      source: 'api',
    });
  });

  console.log(`\n✓ Applied. ${jas.firstName} now holds [${nextRoles.join(', ')}]. AuditEvent written (actor ${actorEmail}).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
