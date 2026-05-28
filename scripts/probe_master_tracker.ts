/**
 * Probe the Foundry Health Master Project Tracker workbook so TT can
 * confirm the sheet name + column layout before we wire up the import.
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

function fmt(c: unknown): string {
  if (c === undefined || c === null) return '';
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).replace(/\s+/g, ' ').slice(0, 60);
}

function main() {
  const file = process.argv[2] ?? DEFAULT;
  if (!fs.existsSync(file)) {
    console.error(`workbook not found: ${file}`);
    process.exit(1);
  }
  const wb = XLSX.readFile(file, { cellDates: true });

  const sheet = wb.Sheets['Commercial Master Tracker'];
  if (!sheet) throw new Error('Commercial Master Tracker sheet missing');

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    raw: true,
    defval: null,
  });

  // Find every FY separator + project leads + counts per FY.
  console.log('FY separator rows (col A):');
  for (let i = 0; i < aoa.length; i += 1) {
    const r = aoa[i] ?? [];
    const a = r[0];
    if (typeof a === 'string' && /FY\s*\d/i.test(a)) {
      console.log(`  r${i.toString().padStart(3)}: A="${a}"`);
    }
  }

  // Dump the LAST 40 rows so we can see the FY25-26 section.
  console.log('\nlast 40 rows:');
  const last = Math.max(0, aoa.length - 40);
  for (let i = last; i < aoa.length; i += 1) {
    const r = aoa[i] ?? [];
    console.log(
      `r${i.toString().padStart(3)}: ${r.map(fmt).join(' | ')}`,
    );
  }

  // What types are dates stored as in this workbook?
  console.log('\nDate cell types (sample 3 data rows from middle):');
  for (const i of [10, 30, 60]) {
    const r = aoa[i] ?? [];
    const start = r[5];
    const end = r[6];
    console.log(
      `r${i}: start=(${typeof start}) ${fmt(start)}  end=(${typeof end}) ${fmt(end)}`,
    );
  }
}

main();
