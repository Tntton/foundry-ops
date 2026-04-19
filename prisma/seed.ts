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

async function ensureUniqueInitials(base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let suffix = 1;
  // Loop — fixture duplicates get '2', '3', etc.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await prisma.person.findUnique({ where: { initials: candidate } });
    if (!clash || (excludeId && clash.id === excludeId)) return candidate;
    suffix += 1;
    candidate = `${base}${suffix}`;
    if (suffix > 99) throw new Error(`Could not generate unique initials for ${base}`);
  }
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
    // Check whether a row exists by email (auth.ts may have auto-created one
    // on first sign-in before seed ran). If so, patch key fields from the
    // fixture — initials, firstName, lastName, band, level, roles — so the
    // fixture stays authoritative. Don't touch external identities or other
    // fields the running app may have populated.
    const existing = await prisma.person.findUnique({ where: { email } });

    const rate = row.rate ?? 0;
    const rateUnit = row.rateUnit === '/h' ? 'hour' : 'day';
    const level = row.level ?? '—';
    const band = mapBand(row.band, row.initials);
    const roles = rolesForPerson(row.initials, row.band, row.title);

    if (existing) {
      const needsPatch =
        existing.firstName !== row.first ||
        existing.lastName !== row.last ||
        existing.band !== band ||
        existing.level !== level ||
        JSON.stringify(existing.roles.slice().sort()) !== JSON.stringify([...roles].sort());
      // Prefer the fixture initials; if taken by a different row, keep the existing initials on our row.
      let nextInitials = existing.initials;
      if (existing.initials !== row.initials) {
        nextInitials = await ensureUniqueInitials(row.initials, existing.id);
      }
      if (needsPatch || nextInitials !== existing.initials) {
        await prisma.person.update({
          where: { id: existing.id },
          data: {
            initials: nextInitials,
            firstName: row.first,
            lastName: row.last,
            band,
            level,
            roles,
          },
        });
        skipped += 1;
        console.log(`  patched ${email}: initials=${nextInitials}, roles=[${roles.join(',')}]`);
      } else {
        skipped += 1;
      }
      continue;
    }

    const newInitials = await ensureUniqueInitials(row.initials);
    await prisma.person.create({
      data: {
        email,
        initials: newInitials,
        firstName: row.first,
        lastName: row.last,
        band,
        level,
        employment: mapEmployment(row.employment),
        fte: row.fte ?? 1.0,
        region: mapRegion(row.region),
        rateUnit,
        rate: toCents(rate),
        roles,
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
