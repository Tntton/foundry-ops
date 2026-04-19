/**
 * Seed Foundry Ops with real Foundry team + rate card data.
 *
 * Sources:
 *  - prisma/fixtures/team.json — derived from foundry-team.jsx (39 people)
 *  - prisma/fixtures/rate-card.json — derived from foundry-ratecard.jsx (15 levels)
 *
 * Guard: refuses to run when NODE_ENV === 'production'. Set FORCE_SEED=1 to
 * override (intended for staging only — never touch prod data).
 */

import { PrismaClient, type Band, type Employment, type Region, type Role } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

type TeamRow = {
  id: string;
  initials: string;
  first: string;
  last: string;
  title?: string;
  band: string;
  level: string | null;
  location?: string;
  region: 'AU' | 'NZ' | 'US' | 'UK';
  email: string;
  employment?: string;
  fte?: number;
  rateUnit?: string; // '/h' | '/d' | 'salary'
  rate?: number;
};

type RateCardRow = {
  code: string;
  label: string;
  band: string;
  rates: Record<string, number | null>;
};

const MANAGING_PARTNER_INITIALS = new Set(['TT']);
const OFFICE_MANAGER_INITIALS = new Set(['JN', 'JS']);

function mapBand(prototypeBand: string, initials: string): Band {
  // Prototype has Partner/Leadership/Expert/Consultant/Fellow/Analyst/Intern/Ops.
  // Schema enum: MP / Partner / Expert / Consultant / Analyst.
  if (prototypeBand === 'Partner' && MANAGING_PARTNER_INITIALS.has(initials)) return 'MP';
  if (prototypeBand === 'Partner') return 'Partner';
  if (prototypeBand === 'Expert') return 'Expert';
  if (prototypeBand === 'Fellow' || prototypeBand === 'Consultant' || prototypeBand === 'Leadership')
    return 'Consultant';
  if (prototypeBand === 'Analyst' || prototypeBand === 'Intern') return 'Analyst';
  // 'Ops' (office manager), or any unknown — map to Consultant as a safe default.
  return 'Consultant';
}

function mapRegion(r: TeamRow['region']): Region {
  return r === 'NZ' ? 'NZ' : 'AU';
}

function mapEmployment(emp?: string): Employment {
  if (!emp) return 'ft';
  if (/contractor|contract|PRN|casual/i.test(emp)) return 'contractor';
  return 'ft';
}

function rolesForPerson(initials: string, band: string, title?: string): Role[] {
  if (MANAGING_PARTNER_INITIALS.has(initials)) return ['super_admin', 'partner'];
  if (OFFICE_MANAGER_INITIALS.has(initials) || /office manager|coo|operations/i.test(title ?? ''))
    return ['super_admin', 'admin'];
  if (band === 'Partner') return ['partner'];
  if (band === 'Leadership') return ['manager'];
  return ['staff'];
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

async function seedRateCard() {
  const fixturePath = path.join(__dirname, 'fixtures', 'rate-card.json');
  const levels = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as RateCardRow[];
  const effectiveFrom = new Date('2025-07-01'); // FY26 start

  let created = 0;
  for (const lvl of levels) {
    const auRate = lvl.rates['AU'];
    if (auRate == null) continue; // no AU rate → skip (Partner rows)
    const existing = await prisma.rateCard.findFirst({
      where: { roleCode: lvl.code, effectiveFrom },
    });
    if (existing) continue;
    await prisma.rateCard.create({
      data: {
        roleCode: lvl.code,
        effectiveFrom,
        costRate: toCents(auRate),
        // Simple heuristic for MVP: bill rate = cost × 2 (low) / × 3 (high)
        billRateLow: toCents(auRate * 2),
        billRateHigh: toCents(auRate * 3),
      },
    });
    created += 1;
  }
  console.log(`  rate card rows created: ${created}`);
}

async function seedTeam() {
  const fixturePath = path.join(__dirname, 'fixtures', 'team.json');
  const team = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as TeamRow[];
  const startDate = new Date('2023-01-01');

  let created = 0;
  let skipped = 0;
  for (const row of team) {
    if (!row.email) {
      skipped += 1;
      continue;
    }
    const email = row.email.toLowerCase();
    // Skip if either email or initials already taken (e.g. auth.ts auto-created
    // the Person row on first sign-in, before seed ran).
    const existing = await prisma.person.findFirst({
      where: { OR: [{ email }, { initials: row.initials }] },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const rate = row.rate ?? 0;
    // 'salary' rate unit in the prototype → treat as day (rate is 0 in those rows anyway).
    const rateUnit = row.rateUnit === '/h' ? 'hour' : 'day';
    // Some rows (e.g. ops staff) have no level code — fall back to '—'.
    const level = row.level ?? '—';

    await prisma.person.create({
      data: {
        email,
        initials: row.initials,
        firstName: row.first,
        lastName: row.last,
        band: mapBand(row.band, row.initials),
        level,
        employment: mapEmployment(row.employment),
        fte: row.fte ?? 1.0,
        region: mapRegion(row.region),
        rateUnit,
        rate: toCents(rate),
        roles: rolesForPerson(row.initials, row.band, row.title),
        startDate,
      },
    });
    created += 1;
  }
  console.log(`  people created: ${created} (skipped ${skipped} existing/no-email)`);
}

async function main() {
  if (process.env['NODE_ENV'] === 'production' && process.env['FORCE_SEED'] !== '1') {
    console.error('[seed] refusing to run in production (set FORCE_SEED=1 to override)');
    process.exit(1);
  }

  console.log('[seed] starting…');
  console.log('[seed] rate card:');
  await seedRateCard();
  console.log('[seed] team:');
  await seedTeam();
  console.log('[seed] done.');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
