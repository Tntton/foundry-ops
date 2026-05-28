import { prisma } from '@/server/db';
async function main() {
  const rows = await prisma.rateCard.findMany({
    orderBy: [{ roleCode: 'asc' }, { effectiveFrom: 'desc' }],
    select: { roleCode: true, effectiveFrom: true, costRate: true, billRateLow: true, billRateHigh: true },
  });
  const codes = new Set(rows.map(r => r.roleCode));
  console.log(`\nDistinct roleCodes on rate card: ${[...codes].sort().join(', ')}`);
  console.log(`\nMost-recent row per code (cents):`);
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.roleCode)) continue;
    seen.add(r.roleCode);
    console.log(`  ${r.roleCode.padEnd(4)} eff=${r.effectiveFrom.toISOString().slice(0,10)} cost=$${(r.costRate/100).toFixed(0)} billLow=$${(r.billRateLow/100).toFixed(0)} billHigh=$${(r.billRateHigh/100).toFixed(0)}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
