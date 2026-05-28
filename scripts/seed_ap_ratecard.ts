import { prisma } from '@/server/db';

/**
 * Seed a placeholder L3 (Associate Partner) row on the rate card if
 * one doesn't already exist. Rates default to $0 — the page renders
 * those as "—" so the row reads as "not yet set" and the operator
 * can fill in real values via the existing edit form.
 *
 * Effective date defaults to today so the row shows up under the
 * "active today" view without needing a back-dated query.
 *
 * Idempotent: if any L3 row exists at all (historical or current),
 * skip. The operator can add additional dated rows via /admin/rate-card.
 */
async function main() {
  const existing = await prisma.rateCard.findFirst({
    where: { roleCode: 'L3' },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (existing) {
    console.log(`L3 row already exists (effective ${existing.effectiveFrom.toISOString().slice(0, 10)}). Skipping seed.`);
    return;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const row = await prisma.rateCard.create({
    data: {
      roleCode: 'L3',
      effectiveFrom: today,
      costRate: 0,
      billRateLow: 0,
      billRateHigh: 0,
    },
  });
  await prisma.auditEvent.create({
    data: {
      actorType: 'system',
      action: 'seeded',
      entityType: 'ratecard',
      entityId: row.id,
      entityDelta: {
        roleCode: 'L3',
        effectiveFrom: today.toISOString().slice(0, 10),
        via: 'ap_role_introduction_seed',
        note: 'Placeholder Associate Partner row. Rates default 0 — admin to fill via /admin/rate-card.',
      },
      source: 'integration_sync',
    },
  });
  console.log(`Seeded L3 (Associate Partner) row: id=${row.id} effective=${today.toISOString().slice(0, 10)}`);
  console.log('Rates left at $0 — open /admin/rate-card to set real values.');
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
