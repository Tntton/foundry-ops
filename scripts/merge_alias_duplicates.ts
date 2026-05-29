import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';

/**
 * One-off cleanup for the TASK-211 email-convention transition.
 *
 * When a person's Entra UPN flips from `firstname@foundry.health` to
 * `firstname.lastname@foundry.health` *before* the DB has been
 * migrated, the signIn callback used to mint a fresh placeholder
 * Person row (empty roles, default band/level) — leaving them with
 * TWO rows: the real one under the short alias, and a stub under the
 * full alias. The user could log in but saw nothing in the menu
 * because the JWT picked up the empty-roles stub.
 *
 * This script finds those pairs and merges them:
 *
 *   - Detects placeholder rows by: empty roles AND default-ish
 *     band/level/rate (the shape signIn creates on first login).
 *   - For each placeholder, looks for a "real" sibling row at the
 *     short alias (same local-part up to the first dot).
 *   - Saves the placeholder's entraUserId (this is the current M365
 *     binding — we MUST keep it).
 *   - Deletes the placeholder (releases the unique entraUserId index).
 *   - Updates the real row: changes email to the full alias + sets
 *     entraUserId to the saved value.
 *   - Writes a `bulk_alias_merge` AuditEvent per pair.
 *
 * Run modes:
 *   pnpm merge:aliases           # apply
 *   pnpm merge:aliases --dry     # preview
 *
 * Idempotent. Safe to re-run — once a placeholder is consumed, there's
 * nothing left to match.
 *
 * The signIn callback itself was also patched (src/server/auth.ts) so
 * new placeholder rows shouldn't be created any more — this script is
 * only for cleaning up the ones already in the DB.
 */

const FOUNDRY_SUFFIX = '@foundry.health';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry');
  const banner = dryRun ? 'DRY RUN — ' : '';

  console.log(`\n=== ${banner}Merge auto-created alias placeholders ===\n`);

  // Pull every Person whose email is the long form (contains a dot in
  // the local-part) AND who looks like a signIn-created placeholder:
  //   - empty roles
  //   - band/level/rate at the signIn defaults
  //   - no real start activity (no timesheets, no expenses)
  // Cast a wide net then narrow per-row so we explain what's filtered.
  const candidates = await prisma.person.findMany({
    where: {
      email: { endsWith: FOUNDRY_SUFFIX },
      roles: { isEmpty: true },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      band: true,
      level: true,
      rate: true,
      entraUserId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const merges: Array<{
    placeholderId: string;
    placeholderEmail: string;
    placeholderEntraUserId: string | null;
    realId: string;
    realEmail: string;
    name: string;
  }> = [];
  const skipped: Array<{ email: string; reason: string }> = [];

  for (const p of candidates) {
    const localAt = p.email.indexOf('@');
    if (localAt <= 0) continue;
    const local = p.email.slice(0, localAt);
    const dot = local.indexOf('.');
    if (dot <= 0) {
      // Already a short-alias row with empty roles — not a placeholder
      // case, just an under-provisioned person. Leave alone.
      continue;
    }

    const aliased = `${local.slice(0, dot)}${FOUNDRY_SUFFIX}`;
    const real = await prisma.person.findUnique({
      where: { email: aliased },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        roles: true,
        entraUserId: true,
      },
    });
    if (!real) {
      skipped.push({ email: p.email, reason: `no sibling row at ${aliased}` });
      continue;
    }
    if (real.roles.length === 0) {
      skipped.push({
        email: p.email,
        reason: `sibling ${aliased} also has empty roles — not a placeholder, leave for manual review`,
      });
      continue;
    }
    // Defensive: refuse if the real row's entraUserId is set AND
    // doesn't match the placeholder's (would mean we'd be merging
    // two different M365 identities — unsafe).
    if (
      real.entraUserId &&
      p.entraUserId &&
      real.entraUserId !== p.entraUserId
    ) {
      skipped.push({
        email: p.email,
        reason: `entraUserId conflict between ${aliased} and ${p.email}`,
      });
      continue;
    }

    merges.push({
      placeholderId: p.id,
      placeholderEmail: p.email,
      placeholderEntraUserId: p.entraUserId,
      realId: real.id,
      realEmail: real.email,
      name: `${real.firstName} ${real.lastName}`,
    });
  }

  console.log(`  Candidates (long-form + empty roles): ${candidates.length}`);
  console.log(`  Mergeable pairs: ${merges.length}`);
  console.log(`  Skipped: ${skipped.length}\n`);

  if (skipped.length > 0) {
    console.log('Skipped rows:');
    for (const s of skipped) {
      console.log(`  · ${s.email.padEnd(40)}  ${s.reason}`);
    }
    console.log();
  }

  if (merges.length === 0) {
    console.log('No merges to apply.');
    return;
  }

  console.log('Planned merges:');
  for (const m of merges) {
    console.log(
      `  · ${m.name.padEnd(28)}  ${m.realEmail.padEnd(40)} → ${m.placeholderEmail}`,
    );
    console.log(
      `    (drop placeholder ${m.placeholderId}, rename real ${m.realId}, carry entraUserId=${m.placeholderEntraUserId ?? '<none>'})`,
    );
  }
  console.log();

  if (dryRun) {
    console.log('Dry run — no writes. Re-run without --dry to apply.\n');
    return;
  }

  for (const m of merges) {
    await prisma.$transaction(async (tx) => {
      // Order matters: delete the placeholder FIRST so its unique
      // entraUserId is released before we try to assign it to the
      // real row, then update the real row's email + entraUserId.
      await tx.person.delete({ where: { id: m.placeholderId } });
      await tx.person.update({
        where: { id: m.realId },
        data: {
          email: m.placeholderEmail,
          ...(m.placeholderEntraUserId
            ? { entraUserId: m.placeholderEntraUserId }
            : {}),
        },
      });
      await writeAudit(tx, {
        actor: { type: 'system' },
        action: 'bulk_alias_merge',
        entity: {
          type: 'person',
          id: m.realId,
          after: {
            mergedFromPlaceholderId: m.placeholderId,
            oldEmail: m.realEmail,
            newEmail: m.placeholderEmail,
            carriedEntraUserId: m.placeholderEntraUserId,
          },
        },
        source: 'integration_sync',
      });
    });
    console.log(`  ✓ merged ${m.name}`);
  }

  console.log(`\nMerged ${merges.length} pair(s).`);
  console.log('Affected users should sign out + sign back in for their JWT to pick up the real roles.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n!! Merge failed:', err);
    process.exit(1);
  });
