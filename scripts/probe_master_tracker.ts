/**
 * Probe the Foundry Health Master Project Tracker workbook.
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
  return String(c).replace(/\s+/g, ' ').slice(0, 50);
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

  // Walk and bucket rows by FY section
  type DataRow = {
    sectionFy: string;
    rowIndex: number;
    client: string;
    code: string;
    name: string;
    description: string;
    startDate: Date | null;
    endDate: Date | null;
    grossRevenue: number | null;
    outstanding: unknown;
    referral: string;
    leads: string;
  };

  let currentFy = '(pre-header)';
  const rows: DataRow[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    // skip header row 1
    if (i === 1) continue;
    const r = aoa[i] ?? [];
    const a = r[0];
    if (typeof a === 'string' && /FY\s*\d/i.test(a)) {
      currentFy = a.trim();
      continue;
    }
    const client = typeof r[1] === 'string' ? r[1].trim() : '';
    const code = typeof r[2] === 'string' ? r[2].trim() : '';
    if (!client && !code) continue; // blank / total row
    const startDate = r[5] instanceof Date ? (r[5] as Date) : null;
    const endDate = r[6] instanceof Date ? (r[6] as Date) : null;
    const grossRaw = r[7];
    const gross =
      typeof grossRaw === 'number'
        ? grossRaw
        : typeof grossRaw === 'string'
          ? Number(grossRaw.replace(/[^0-9.\-]/g, '')) || null
          : null;
    rows.push({
      sectionFy: currentFy,
      rowIndex: i,
      client,
      code,
      name: typeof r[3] === 'string' ? r[3].trim() : String(r[3] ?? ''),
      description: typeof r[4] === 'string' ? r[4].trim() : '',
      startDate,
      endDate,
      grossRevenue: gross,
      outstanding: r[8] ?? null,
      referral: typeof r[9] === 'string' ? r[9].trim() : '',
      leads: typeof r[10] === 'string' ? r[10].trim() : '',
    });
  }

  // Counts per FY section
  const fyCounts = new Map<string, number>();
  for (const row of rows) {
    fyCounts.set(row.sectionFy, (fyCounts.get(row.sectionFy) ?? 0) + 1);
  }
  console.log('rows per FY section (label as written in column A):');
  for (const [fy, n] of fyCounts) console.log(`  ${fy.padEnd(15)} ${n}`);

  // Date-based bucketing — what really matters
  const CUTOFF = new Date('2025-07-01T00:00:00Z');
  let live = 0;
  let archived = 0;
  let noDate = 0;
  for (const row of rows) {
    if (!row.startDate) {
      noDate += 1;
    } else if (row.startDate >= CUTOFF) {
      live += 1;
    } else {
      archived += 1;
    }
  }
  console.log(`\ndate-based bucket (startDate >= 2025-07-01):`);
  console.log(`  live      ${live}`);
  console.log(`  archived  ${archived}`);
  console.log(`  no date   ${noDate}`);

  // Distinct clients
  const clients = new Map<string, number>();
  for (const row of rows) {
    if (!row.client) continue;
    const key = row.client.toLowerCase();
    clients.set(key, (clients.get(key) ?? 0) + 1);
  }
  console.log(`\ndistinct clients (n=${clients.size}):`);
  for (const [name, n] of [...clients.entries()].sort()) {
    console.log(`  ${name.padEnd(40)} ${n}`);
  }

  // Duplicate project codes
  const codes = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.code) continue;
    const list = codes.get(row.code) ?? [];
    list.push(row.rowIndex);
    codes.set(row.code, list);
  }
  const dupes = [...codes.entries()].filter(([_, list]) => list.length > 1);
  console.log(`\nduplicate project codes (n=${dupes.length}):`);
  for (const [code, list] of dupes) {
    console.log(`  ${code.padEnd(12)} rows: ${list.join(',')}`);
  }

  // Distinct lead initials
  const initials = new Set<string>();
  for (const row of rows) {
    for (const part of [row.referral, row.leads]) {
      if (!part) continue;
      for (const init of part.split(/[\/,&\s]+/)) {
        const cleaned = init.trim().toUpperCase();
        if (cleaned && cleaned.length <= 4) initials.add(cleaned);
      }
    }
  }
  console.log(`\ndistinct initials (referral + leads): ${[...initials].sort().join(' ')}`);

  // Rows with no contract value
  const noValue = rows.filter((r) => !r.grossRevenue);
  console.log(`\nrows with missing gross revenue: ${noValue.length}`);
  for (const r of noValue) {
    console.log(
      `  r${r.rowIndex} ${r.code.padEnd(10)} ${r.client.padEnd(30)} ${fmt(r.startDate)} → ${fmt(r.endDate)}`,
    );
  }

  // Rows missing dates
  const noStart = rows.filter((r) => !r.startDate);
  console.log(`\nrows with no startDate: ${noStart.length}`);
  for (const r of noStart) {
    console.log(
      `  r${r.rowIndex} ${r.code.padEnd(10)} ${r.client.padEnd(30)} leads=${r.leads}`,
    );
  }
}

main();
