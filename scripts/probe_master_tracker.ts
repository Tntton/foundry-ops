/**
 * Probe the Foundry Health Master Project Tracker workbook so TT can
 * confirm the sheet name + column layout before we wire up the import.
 *
 * Pass a local path (defaults to ~/Downloads). The Graph-download version
 * lives in scripts/master_tracker_pull.ts.
 *
 *   pnpm tsx scripts/probe_master_tracker.ts [/path/to/file.xlsx]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';

const DEFAULT = path.join(
  process.env.HOME ?? '',
  'Downloads',
  'Foundry Health Master Project Tracker.xlsx',
);

function main() {
  const file = process.argv[2] ?? DEFAULT;
  if (!fs.existsSync(file)) {
    console.error(`workbook not found: ${file}`);
    process.exit(1);
  }
  console.log(`opening ${file}`);
  const wb = XLSX.readFile(file, { cellDates: true });
  console.log(`\nsheets (${wb.SheetNames.length}):`);
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const ref = ws['!ref'] ?? '';
    const range = ref ? XLSX.utils.decode_range(ref) : null;
    const rows = range ? range.e.r - range.s.r + 1 : 0;
    const cols = range ? range.e.c - range.s.c + 1 : 0;
    console.log(`  ${name.padEnd(28)} ${ref}  (${rows} rows × ${cols} cols)`);
  }

  // Dump the first 8 rows of every sheet so we can see header
  // conventions across years.
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    console.log(`\n────── ${name} ──────`);
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      blankrows: false,
      raw: false,
      defval: '',
    });
    const peek = aoa.slice(0, 8);
    for (let i = 0; i < peek.length; i += 1) {
      const cells = (peek[i] ?? []).map((c) =>
        c === undefined || c === null
          ? ''
          : String(c).replace(/\s+/g, ' ').slice(0, 40),
      );
      console.log(`r${i.toString().padStart(2)}: ${cells.join(' | ')}`);
    }
    console.log(`(${aoa.length} total rows)`);
  }
}

main();
