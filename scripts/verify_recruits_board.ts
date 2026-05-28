import { getRecruitBoard } from '@/server/recruits';

async function main() {
  const board = await getRecruitBoard();
  console.log(`\n=== Recruitment board: ${board.totalActive} active · ${board.totalNixed} nixed ===\n`);
  for (const col of board.columns) {
    console.log(`[${col.label}] · ${col.cards.length}`);
    for (const c of col.cards) {
      const stage = c.stage ? ` · ${c.stage}` : '';
      const ref = c.referredBy ? ` · ref ${c.referredBy.firstName}` : '';
      console.log(`  ● ${c.firstName} ${c.lastName} (${c.daysInPipeline}d)${stage} · via ${c.source ?? '—'}${ref}`);
    }
    console.log();
  }
  console.log(`[Nixed] · ${board.nixed.length}`);
  for (const c of board.nixed) {
    console.log(`  ✕ ${c.firstName} ${c.lastName} · ${c.notes ?? '—'}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
