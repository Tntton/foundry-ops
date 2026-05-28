import { prisma } from '@/server/db';

/**
 * One-time migration: existing people stored under the legacy
 * `band='Partner', level='L3'` convention get promoted to the
 * new canonical `band='Associate_Partner', role='associate_partner'`.
 *
 * Idempotent: rows already at band='Associate_Partner' are skipped.
 *
 * Audit: writes one AuditEvent per migrated person so the change
 * is traceable + reversible. Per locked decision A9 (audit every
 * mutation) — the actor is the seed-script ("system") because no
 * specific person triggered this.
 *
 * Safe semantics:
 *  - If the person ALSO holds `super_admin` or `admin`, we leave
 *    those roles intact (TT-style multi-hat case). Only the
 *    `partner` role is swapped for `associate_partner`.
 *  - If they don't have `partner` at all (e.g. already migrated
 *    or had a different role-hat combo), we still update band/level
 *    but add `associate_partner` to the roles array.
 *
 * Run with `--dry` to preview without mutating.
 */
async function main() {
  const dryRun = process.argv.includes('--dry');
  const candidates = await prisma.person.findMany({
    where: {
      band: 'Partner',
      level: 'L3',
      inactiveAt: null,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      band: true,
      level: true,
      roles: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  console.log(
    `\n=== ${dryRun ? 'DRY RUN — ' : ''}L3-Partner → Associate Partner migration ===`,
  );
  console.log(`Found ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`);

  if (candidates.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  let applied = 0;
  for (const p of candidates) {
    const nextRoles = p.roles
      .filter((r) => r !== 'partner')
      .filter((r) => r !== 'associate_partner');
    nextRoles.push('associate_partner');

    console.log(`\n  ${p.firstName} ${p.lastName} (${p.email})`);
    console.log(
      `    band:  Partner → Associate_Partner`,
    );
    console.log(
      `    roles: [${p.roles.join(',')}] → [${nextRoles.join(',')}]`,
    );
    console.log(
      `    level: L3 (unchanged — L3 now correctly sits under Associate_Partner band per levels.ts)`,
    );

    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      const before = {
        band: p.band,
        level: p.level,
        roles: p.roles,
      };
      await tx.person.update({
        where: { id: p.id },
        data: {
          band: 'Associate_Partner',
          roles: nextRoles,
        },
      });
      const after = {
        band: 'Associate_Partner',
        level: p.level,
        roles: nextRoles,
      };
      await tx.auditEvent.create({
        data: {
          actorType: 'system',
          action: 'migrated_to_associate_partner',
          entityType: 'person',
          entityId: p.id,
          entityDelta: { before, after, via: 'l3_partner_to_ap_migration' },
          source: 'integration_sync',
        },
      });
    });
    applied += 1;
  }

  console.log(
    `\n=== ${dryRun ? 'DRY RUN COMPLETE' : `Applied ${applied} of ${candidates.length}`} ===`,
  );
  if (dryRun) {
    console.log('Re-run without --dry to apply.');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
