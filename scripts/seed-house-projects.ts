/**
 * Idempotent seed of the firm-overhead "bucket" projects + the first
 * internal FH project.
 *
 * Buckets (used to tag expenses that aren't tied to a client engagement):
 *   FHB000 — Foundry Health business development (firm-level BD)
 *   FHO000 — Operations
 *   FHX000 — Uncategorised
 *
 * Internal FH projects (real projects, no client revenue):
 *   FHP001 — Homefield Partners Project
 *   (FHP002, FHP003, ... created via the normal project-create flow)
 *
 * All buckets + FHP* projects are backed by an internal Foundry Health
 * client so the existing Project schema (clientId required) holds.
 * Lead partner and manager default to TT — the firm's MP. Buckets stay
 * in `delivery` permanently so they're treated as active for tagging
 * and never archive. FHP* projects start in `delivery` so the team
 * can log time against them straight away.
 *
 * Migration step: an earlier seed used FHP000 for the BD bucket. If we
 * find that code, rename it to FHB000 in place so existing data isn't
 * orphaned.
 *
 * Run: pnpm tsx scripts/seed-house-projects.ts
 */
import { PrismaClient, type ProjectStage } from '@prisma/client';

const prisma = new PrismaClient();

const HOUSE_CLIENT = {
  code: 'FH',
  legalName: 'Foundry Health (internal)',
};

const BUCKET_PROJECTS: Array<{
  code: string;
  name: string;
  description: string;
}> = [
  {
    code: 'FHB000',
    name: 'BD / Pipeline',
    description:
      'Firm-level business development — proposal time, conference fees, ' +
      'pre-engagement client meetings, marketing collateral. Not tied to ' +
      'a specific client engagement.',
  },
  {
    code: 'FHO000',
    name: 'Operations',
    description:
      'Firm operations — software subscriptions, professional services, ' +
      'office costs, anything keeping the firm running between projects.',
  },
  {
    code: 'FHX000',
    name: 'Uncategorised',
    description:
      'Holding bucket for expenses pending proper allocation. Move to ' +
      'a real project (or FHB / FHO) before approval.',
  },
];

// Internal FH projects — real projects that the team logs time
// against, but no client / no revenue. Some are "standing" (always
// open, ongoing — primer development, social media), some are
// episodic and may pause and come back (conferences, brand
// refreshes). They render in the dedicated "Internal projects" band
// on /projects so they don't compete visually with paying-client
// engagements.
const INTERNAL_FH_PROJECTS: Array<{
  code: string;
  name: string;
  description: string;
}> = [
  {
    code: 'FHP001',
    name: 'Homefield Partners Project',
    description:
      'Internal Foundry Health initiative — tracked like a normal project ' +
      'so the team can log time and expenses against it. No client revenue.',
  },
  {
    code: 'FHP002',
    name: 'Primer development · standing',
    description:
      'Ongoing development + maintenance of FH primers (clinical, ' +
      'commercial, regulatory). Always open — log time when you draft, ' +
      'review, or update a primer.',
  },
  {
    code: 'FHP003',
    name: 'Social media · standing',
    description:
      'LinkedIn / Substack / firm channel content. Always open — log ' +
      'time when you draft, post, or review social content.',
  },
  {
    code: 'FHP004',
    name: 'Brand & website · standing',
    description:
      'foundry.health website, brand refreshes, deck templates, intro ' +
      'collateral. Standing project — episodic bursts when assets need ' +
      'refreshing.',
  },
  {
    code: 'FHP005',
    name: 'Conferences & events',
    description:
      'Conference attendance, panel prep, event sponsorship work. ' +
      'Episodic — opens and closes around individual events.',
  },
  {
    code: 'FHP006',
    name: 'Internal training & onboarding',
    description:
      'Onboarding new joiners + internal training sessions. Standing ' +
      'project — log time when running sessions or building training ' +
      'material.',
  },
];

async function main() {
  // Resolve TT as the default lead — must exist or the seed bails.
  const tt = await prisma.person.findUnique({
    where: { email: 'trung@foundry.health' },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!tt) {
    console.error(
      'Cannot seed house projects — Trung Ton not found. Run people seed first.',
    );
    process.exit(1);
  }
  console.log(`default lead: ${tt.firstName} ${tt.lastName}`);

  // Upsert the internal client.
  const fhClient = await prisma.client.upsert({
    where: { code: HOUSE_CLIENT.code },
    create: {
      code: HOUSE_CLIENT.code,
      legalName: HOUSE_CLIENT.legalName,
      clientType: 'private_company',
      country: 'AU',
      primaryPartnerId: tt.id,
    },
    update: {
      legalName: HOUSE_CLIENT.legalName,
    },
    select: { id: true, code: true },
  });
  console.log(`internal client: ${fhClient.code}`);

  // Migrate legacy FHP000 (old BD bucket) → FHB000 if present.
  const legacy = await prisma.project.findUnique({
    where: { code: 'FHP000' },
    select: { id: true, name: true },
  });
  if (legacy) {
    // Only rename if FHB000 doesn't already exist — otherwise the unique
    // constraint blocks us and we skip (assume the operator already
    // moved data manually).
    const collision = await prisma.project.findUnique({
      where: { code: 'FHB000' },
      select: { id: true },
    });
    if (!collision) {
      await prisma.project.update({
        where: { id: legacy.id },
        data: { code: 'FHB000', name: 'BD / Pipeline' },
      });
      console.log('migrate: FHP000 → FHB000 (renamed in place)');
    } else {
      console.log(
        'skip migrate: both FHP000 and FHB000 exist — resolve manually',
      );
    }
  }

  let created = 0;
  let kept = 0;
  for (const p of [...BUCKET_PROJECTS, ...INTERNAL_FH_PROJECTS]) {
    const existing = await prisma.project.findUnique({
      where: { code: p.code },
      select: { id: true, code: true },
    });
    if (existing) {
      // Re-runs leave the project alone (in case partners have edited
      // the description / stage), just confirm presence.
      kept += 1;
      console.log(`keep : ${p.code}`);
      continue;
    }
    await prisma.project.create({
      data: {
        code: p.code,
        name: p.name,
        description: p.description,
        clientId: fhClient.id,
        primaryPartnerId: tt.id,
        managerId: tt.id,
        stage: 'delivery' as ProjectStage,
        contractValue: 0,
        currency: 'AUD',
        // Buckets can't be archived through the normal flow — they're
        // meant to live permanently as expense buckets. FHP* internal
        // projects can be archived once the initiative wraps.
      },
    });
    created += 1;
    console.log(`add  : ${p.code}  ${p.name}`);
  }
  console.log(`\ndone: created ${created}, kept ${kept}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
