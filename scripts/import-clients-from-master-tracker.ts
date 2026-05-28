/**
 * Idempotent import of the client roster from Foundry's master tracker
 * CSV. Reads the clients listed in the FY tracker, normalises duplicates
 * (case-insensitive name match — `GenesisCare` vs `Genesiscare`),
 * derives a 3-letter code when the tracker doesn't have one, and
 * upserts into the `Client` table.
 *
 * The tracker carries name + code + project metadata; we only seed
 * (legalName, code, clientType, primaryPartnerId, country) here and
 * leave structured address / billing contact / ABN to be filled in via
 * the directory client-edit flow (or a future ABR enrichment pass).
 *
 * Run:  pnpm tsx scripts/import-clients-from-master-tracker.ts [csvPath]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_CSV =
  '/Users/tnt/Downloads/Foundry Health Master Project Tracker(Commercial Master Tracker).csv';

// Manual code overrides for clients that don't carry one in the tracker.
// Keys lower-case for case-insensitive lookup.
const MANUAL_CODES: Record<string, string> = {
  hca: 'HCA',
  'soul patts': 'SOL',
};

// Manual name canonicalisation — collapses "Genesiscare" → "GenesisCare"
// so the import doesn't create two rows for the same client.
const NAME_OVERRIDES: Record<string, string> = {
  genesiscare: 'GenesisCare',
};

function parseCsv(text: string): string[][] {
  // Tiny RFC-4180-ish parser — sufficient for the master tracker which
  // only uses double-quote escaping. Avoids pulling in a CSV dependency.
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (ch === '\r') {
        // skip
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function deriveCode(name: string, taken: Set<string>): string {
  // Prefer the first letters of the first 1-2 words, uppercase, length 3.
  const cleaned = name.replace(/[^a-zA-Z\s]/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  let base = (words.slice(0, 3).map((w) => w[0]).join('') || 'CLI')
    .toUpperCase()
    .padEnd(3, 'X')
    .slice(0, 3);
  let candidate = base;
  let suffix = 1;
  while (taken.has(candidate)) {
    candidate = `${base.slice(0, 2)}${suffix}`;
    suffix += 1;
    if (suffix > 99) throw new Error(`Could not derive unique code for ${name}`);
  }
  return candidate;
}

async function main() {
  const csvPath = process.argv[2] ?? DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found at ${csvPath}`);
    process.exit(1);
  }
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 4) {
    console.error('CSV looks empty or missing header rows.');
    process.exit(1);
  }

  // Header sits at row index 2 — first two rows are the title block.
  const dataRows = rows.slice(3);

  // Aggregate (canonicalName) → (codes seen).
  const byName = new Map<string, { name: string; codes: Set<string> }>();
  for (const r of dataRows) {
    const rawName = (r[1] ?? '').trim();
    const rawCode = (r[2] ?? '').trim();
    if (!rawName) continue;
    const lc = rawName.toLowerCase();
    const canonical = NAME_OVERRIDES[lc] ?? rawName;
    const key = canonical.toLowerCase();
    const cur = byName.get(key) ?? { name: canonical, codes: new Set() };
    if (rawCode) {
      // Project codes look like "AEV001" — keep just the leading
      // letters as the client prefix. Some legacy rows have suffixes
      // like "IFM001-vF" so we explicitly take the leading [A-Z]+ run.
      const match = rawCode.toUpperCase().match(/^[A-Z]+/);
      const prefix = match?.[0] ?? '';
      if (prefix.length >= 2) cur.codes.add(prefix);
    }
    byName.set(key, cur);
  }

  // Locate a default primary partner (TT) so newly-created Clients
  // satisfy the `primaryPartnerId` non-null constraint. Operators can
  // re-assign per client later via the directory flow.
  const defaultPartner = await prisma.person.findUnique({
    where: { email: 'trung@foundry.health' },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!defaultPartner) {
    console.error(
      'No fallback partner — Trung Ton not in DB. Run seeds first.',
    );
    process.exit(1);
  }
  console.log(
    `default primary partner: ${defaultPartner.firstName} ${defaultPartner.lastName}`,
  );

  const existingClients = await prisma.client.findMany({
    select: { code: true, legalName: true },
  });
  const takenCodes = new Set(existingClients.map((c) => c.code));
  const existingByName = new Map(
    existingClients.map((c) => [c.legalName.toLowerCase(), c]),
  );

  let created = 0;
  let skipped = 0;

  for (const [, info] of byName) {
    const codeFromTracker = [...info.codes][0]; // first prefix encountered
    const codeFromManual = MANUAL_CODES[info.name.toLowerCase()];
    let code = (codeFromTracker ?? codeFromManual ?? '').toUpperCase();
    if (!code) code = deriveCode(info.name, takenCodes);

    // Skip if either code or name is already on the books — keep the
    // existing row untouched so partners' manual edits aren't blown
    // away on a re-run.
    const lcName = info.name.toLowerCase();
    if (existingByName.has(lcName) || takenCodes.has(code)) {
      skipped += 1;
      console.log(
        `skip: ${info.name}  (${code}) — already in DB`,
      );
      continue;
    }

    await prisma.client.create({
      data: {
        code,
        legalName: info.name,
        clientType: 'private_company',
        country: 'AU',
        primaryPartnerId: defaultPartner.id,
      },
    });
    takenCodes.add(code);
    existingByName.set(lcName, { code, legalName: info.name });
    created += 1;
    console.log(`add : ${code}  ${info.name}`);
  }

  console.log(`\ndone: created ${created}, skipped ${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
