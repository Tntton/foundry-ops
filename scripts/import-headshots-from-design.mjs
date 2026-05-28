/**
 * One-shot import — populates Person.headshotUrl from the avatar URLs in
 * the design handoff (`foundry-team.jsx`). Match key is **first + last
 * name** rather than initials because the design file contains
 * duplicate-initials clashes (e.g. AA = Adrian Aurrecoechea AND Akhila
 * Annamreddi); the DB resolves those with suffixed initials (AA / AA2)
 * but the source-of-truth pairing is the human name.
 *
 * Stores the URL as-is on Person.headshotUrl. The image stays hosted on
 * the Wix CDN — we only persist the reference, never download.
 *
 * Run via:
 *   node scripts/import-headshots-from-design.mjs
 *
 * Idempotent — re-running overwrites with the same URL. Doesn't touch
 * any other Person field.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const teamFile = join(__dirname, '..', 'foundry-team.jsx');

const raw = readFileSync(teamFile, 'utf8');

/**
 * Parse `{ ..., first: 'X', last: 'Y', initials: 'XY', avatar: '...' }`
 * blocks out of the design file. The file is JSX, not JSON — using a
 * regex per record beats spinning up a JS evaluator.
 */
function extractEntries(source) {
  const out = [];
  const blocks = source.split(/\n\s*\{/).slice(1);
  for (const block of blocks) {
    const first = block.match(/\bfirst\s*:\s*['"]([^'"]+)['"]/);
    const last = block.match(/\blast\s*:\s*['"]([^'"]+)['"]/);
    const initials = block.match(/\binitials\s*:\s*['"]([^'"]+)['"]/);
    const avatar = block.match(/\bavatar\s*:\s*['"]([^'"]+)['"]/);
    if (first && last && avatar) {
      out.push({
        firstName: first[1].trim(),
        lastName: last[1].trim(),
        initials: initials ? initials[1].trim() : null,
        avatar: avatar[1].trim(),
      });
    }
  }
  return out;
}

const entries = extractEntries(raw);
console.log(`Parsed ${entries.length} team entries with avatar URLs.`);

const prisma = new PrismaClient();

let updated = 0;
let unchanged = 0;
const noMatch = [];

try {
  for (const e of entries) {
    // Match by firstName + lastName — case-insensitive, exact compare
    // after trim. Postgres `mode: 'insensitive'` keeps this resilient
    // to capitalisation drift between sources.
    const candidates = await prisma.person.findMany({
      where: {
        firstName: { equals: e.firstName, mode: 'insensitive' },
        lastName: { equals: e.lastName, mode: 'insensitive' },
      },
      select: { id: true, initials: true, headshotUrl: true },
    });
    if (candidates.length === 0) {
      noMatch.push(`${e.firstName} ${e.lastName}`);
      continue;
    }
    if (candidates.length > 1) {
      console.warn(
        `  ⚠️  Multiple DB rows for "${e.firstName} ${e.lastName}" — skipping; resolve manually.`,
      );
      noMatch.push(`${e.firstName} ${e.lastName} (ambiguous)`);
      continue;
    }
    const [person] = candidates;
    if (person.headshotUrl === e.avatar) {
      unchanged += 1;
      continue;
    }
    await prisma.person.update({
      where: { id: person.id },
      data: { headshotUrl: e.avatar },
    });
    await prisma.auditEvent.create({
      data: {
        actorType: 'system',
        action: 'updated',
        entityType: 'person',
        entityId: person.id,
        entityDelta: {
          via: 'import_headshots_from_design',
          before: { headshotUrl: person.headshotUrl },
          after: { headshotUrl: e.avatar },
        },
        source: 'integration_sync',
      },
    });
    updated += 1;
    console.log(
      `  ✓ ${e.firstName} ${e.lastName} (${person.initials})`,
    );
  }
} finally {
  await prisma.$disconnect();
}

console.log(`\nDone — ${updated} updated, ${unchanged} already up to date.`);
if (noMatch.length > 0) {
  console.log(`Could not find DB row for:`);
  for (const n of noMatch) console.log(`  · ${n}`);
}
