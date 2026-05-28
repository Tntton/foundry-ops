/**
 * Standalone parse smoke-test (no DB) — proves the workbook parses
 * cleanly and produces the expected counts before we wire it up to a
 * real Prisma client. Useful for showing TT the import shape.
 *
 *   pnpm tsx scripts/dryrun_master_tracker_parse.ts [/path/to/file.xlsx]
 *
 * Writes /tmp/import-preview.json so the full plan can be inspected.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPlan, parseWorkbook, printPlan } from './_master_tracker_lib';

const DEFAULT = path.join(
  process.env.HOME ?? '',
  'Downloads',
  'Foundry Health Master Project Tracker.xlsx',
);

function main() {
  const file = process.argv[2] ?? DEFAULT;
  const rows = parseWorkbook(file);
  console.log(`parsed ${rows.length} project rows`);
  // No DB → TT id placeholder + empty known-initials map.
  const plan = buildPlan(rows, 'TT_PLACEHOLDER', new Map(), file);
  printPlan(plan);
  fs.writeFileSync('/tmp/import-preview.json', JSON.stringify(plan, null, 2));
  console.log('\npreview JSON: /tmp/import-preview.json');
}

main();
