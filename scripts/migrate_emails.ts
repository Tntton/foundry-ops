import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';

/**
 * One-time email-format migration: rename every Person.email from the
 * legacy first-name-only convention (e.g. `will@foundry.health`) to the
 * canonical `firstname.lastname@foundry.health` shape. The three full
 * partners (Trung / Michael / Chris) keep their first-name-only alias
 * because that's what the firm actually uses for them; everyone else
 * gets the long form, with Rachael explicitly set to `rachael.spooner@`.
 *
 * Run modes:
 *   pnpm migrate:emails           # apply
 *   pnpm migrate:emails --dry     # preview (no writes)
 *
 * Idempotency: the script keys every UPDATE off the OLD email, so a
 * second run finds zero matching rows and exits cleanly. Safe to re-run.
 *
 * Audit: one bulk `bulk_email_migrate` AuditEvent for the whole batch,
 * actor=system, with the old→new map embedded in the delta so the
 * rename is fully reversible from the audit trail alone.
 *
 * After this script: M365 UPNs / Xero contacts / saved Resend templates
 * still need separate coordination — see TASK-211 in TASKS.md.
 */

const MAPPING: ReadonlyArray<readonly [string, string]> = [
  ['will@foundry.health', 'will.macdonald@foundry.health'],
  ['doug@foundry.health', 'doug.barnaby@foundry.health'],
  ['kathleen@foundry.health', 'kathleen.weaver@foundry.health'],
  ['mark@foundry.health', 'mark.luhovy@foundry.health'],
  ['rachael@foundry.health', 'rachael.spooner@foundry.health'],
  ['alejandro@foundry.health', 'alejandro.rosales@foundry.health'],
  ['adrian@foundry.health', 'adrian.aurrecoechea@foundry.health'],
  ['matt@foundry.health', 'matt.byers@foundry.health'],
  ['abbi@foundry.health', 'abbi.linghanathan@foundry.health'],
  ['jas@foundry.health', 'jas.navarro@foundry.health'],
  ['sohyb@foundry.health', 'sohyb.basir@foundry.health'],
  ['simone@foundry.health', 'simone.sandler@foundry.health'],
  ['jackie@foundry.health', 'jackie.rabec@foundry.health'],
  ['garang@foundry.health', 'garang.dut@foundry.health'],
  ['bharat@foundry.health', 'bharat.ramakrishna@foundry.health'],
  ['rahul@foundry.health', 'rahul.gandhi@foundry.health'],
  ['sarah@foundry.health', 'sarah.ravindran@foundry.health'],
  ['kevin@foundry.health', 'kevin.mao@foundry.health'],
  ['ingrid@foundry.health', 'ingrid.maravilla@foundry.health'],
  ['haram@foundry.health', 'haram.hwang@foundry.health'],
  ['julia@foundry.health', 'julia.maguire@foundry.health'],
  ['akhila@foundry.health', 'akhila.annamreddi@foundry.health'],
  ['sanjay@foundry.health', 'sanjay.hettige@foundry.health'],
  ['lucas@foundry.health', 'lucas.hu@foundry.health'],
  ['allen@foundry.health', 'allen.xiao@foundry.health'],
  ['josh@foundry.health', 'josh.ting@foundry.health'],
  ['lucast@foundry.health', 'lucas.tan@foundry.health'],
  ['jacky@foundry.health', 'jacky.chen@foundry.health'],
  ['esther@foundry.health', 'esther.lee@foundry.health'],
  ['harry@foundry.health', 'harry.lee@foundry.health'],
  ['henry@foundry.health', 'henry.luo@foundry.health'],
  ['angela@foundry.health', 'angela.pan@foundry.health'],
  ['palash@foundry.health', 'palash.trivedi@foundry.health'],
  ['xiaohan@foundry.health', 'xiaohan.qian@foundry.health'],
  ['markliu@foundry.health', 'mark.liu@foundry.health'],
  ['shea@foundry.health', 'shea.laws@foundry.health'],
] as const;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry');
  const banner = dryRun ? 'DRY RUN — ' : '';

  console.log(`\n=== ${banner}Email convention migration ===`);
  console.log(
    `Renaming ${MAPPING.length} Person rows from firstname-only → firstname.lastname.`,
  );
  console.log(`Three full partners (trung@ / michael@ / chris@) are intentionally NOT touched.\n`);

  // Pre-flight: confirm which old emails actually exist in the DB.
  // Filters out mappings that have already been applied (idempotency).
  const oldEmails = MAPPING.map(([from]) => from);
  const present = await prisma.person.findMany({
    where: { email: { in: oldEmails } },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const presentByEmail = new Map(present.map((p) => [p.email, p]));

  const willApply: Array<{
    personId: string;
    oldEmail: string;
    newEmail: string;
    name: string;
  }> = [];
  const collisions: Array<{ from: string; to: string }> = [];
  // Also check: does the TARGET email already exist? If so, the rename
  // would collide on the unique index and the transaction would abort —
  // surface that up front so the user can investigate.
  const newEmails = MAPPING.map(([, to]) => to);
  const targetTaken = await prisma.person.findMany({
    where: { email: { in: newEmails } },
    select: { id: true, email: true },
  });
  const takenSet = new Set(targetTaken.map((p) => p.email));

  for (const [from, to] of MAPPING) {
    const row = presentByEmail.get(from);
    if (!row) continue; // already migrated or never existed
    if (takenSet.has(to) && targetTaken.find((p) => p.email === to)?.id !== row.id) {
      collisions.push({ from, to });
      continue;
    }
    willApply.push({
      personId: row.id,
      oldEmail: from,
      newEmail: to,
      name: `${row.firstName} ${row.lastName}`,
    });
  }

  console.log(`  ${willApply.length} row(s) to rename`);
  console.log(`  ${MAPPING.length - willApply.length - collisions.length} already migrated (skipped)`);
  console.log(`  ${collisions.length} collision(s) blocking the rename\n`);

  if (collisions.length > 0) {
    console.log('!! Collisions detected — the target email is already used by a DIFFERENT person:');
    for (const c of collisions) {
      console.log(`     ${c.from}  →  ${c.to}  (target already taken)`);
    }
    console.log('   Resolve manually before re-running.\n');
    process.exit(1);
  }

  if (willApply.length === 0) {
    console.log('Nothing to do — every mapped person already has the new email.');
    return;
  }

  for (const r of willApply) {
    console.log(`  ${r.oldEmail.padEnd(40)} →  ${r.newEmail.padEnd(45)} ${r.name}`);
  }
  console.log();

  if (dryRun) {
    console.log('Dry run — no writes. Re-run without --dry to apply.\n');
    return;
  }

  // Apply in one transaction with a single bulk-audit row.
  await prisma.$transaction(async (tx) => {
    for (const r of willApply) {
      await tx.person.update({
        where: { id: r.personId },
        data: { email: r.newEmail },
      });
    }
    await writeAudit(tx, {
      actor: { type: 'system' },
      action: 'bulk_email_migrate',
      entity: {
        type: 'person',
        id: 'bulk',
        after: {
          renamed: willApply.length,
          mapping: willApply.map((r) => ({
            personId: r.personId,
            name: r.name,
            from: r.oldEmail,
            to: r.newEmail,
          })),
        },
      },
      // No `system` value in the AuditSource enum — `integration_sync`
      // is the convention used for other one-off CLI-driven migrations
      // (see scripts/migrate_l3_to_ap.ts).
      source: 'integration_sync',
    });
  });

  console.log(`Renamed ${willApply.length} Person row(s) + wrote 1 bulk audit event.`);
  console.log('\nNEXT STEPS (out of scope for this script — coordinate manually):');
  console.log('  · M365 / Entra: rename UPNs to match; keep old addresses as aliases until end of FY26.');
  console.log('  · Xero: update contractor contact emails.');
  console.log('  · Resend / DocuSign / WhatsApp: audit saved templates / recipient lists.');
  console.log('  · /admin/audit: confirm the bulk_email_migrate row is present.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n!! Migration failed:', err);
    process.exit(1);
  });
