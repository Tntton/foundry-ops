/**
 * Phase 2 — Parse the Foundry Health Master Project Tracker workbook
 * and upsert Clients + Projects.
 *
 *   pnpm tsx scripts/import_master_tracker.ts                # dry-run (default)
 *   pnpm tsx scripts/import_master_tracker.ts --execute      # commit to DB
 *   pnpm tsx scripts/import_master_tracker.ts --file ~/Downloads/foo.xlsx
 *
 * Single sheet "Commercial Master Tracker" carries every FY's projects.
 * Header row is row 1 (zero-indexed); FY separator rows have the FY
 * label in column A (e.g. "FY 24-25") and no other content.
 *
 * Header layout:
 *   B Client | C Project Code | D Project Name | E Description
 *   F Start date | G End date | H Gross Revenue (AUD, ex GST)
 *   I Status (outstanding) | J Referral | K Project leads
 *
 * Live-vs-archived cutoff is date-based:
 *   startDate >= 2025-07-01 → live (delivery / closing depending on outstanding)
 *   startDate <  2025-07-01 → archived
 *   no startDate            → live, stage = kickoff (flagged for TT)
 *
 * Duplicate project codes (today: ADV002 across rows 37+51): last
 * occurrence wins, since the tracker repeats the code only when a
 * project is updated across FYs.
 *
 * Partner / manager matching: parses "Project leads" cell of the form
 * "TT/MB" → primary TT, manager MB (falls back to primary). Initials
 * matched against Person.initials. Anything that doesn't match falls
 * back to TT and is logged in the manual-review list.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient, ProjectStage, type Prisma } from '@prisma/client';
import { writeAudit } from '@/server/audit';
import { buildPlan, parseWorkbook, printPlan, type ImportPlan } from './_master_tracker_lib';

const prisma = new PrismaClient();
const TT_EMAIL = 'trung@foundry.health';
const DEFAULT_FILE = path.join(
  process.env.HOME ?? '',
  'Downloads',
  'Foundry Health Master Project Tracker.xlsx',
);
const PREVIEW_PATH = '/tmp/import-preview.json';

async function execute(plan: ImportPlan, ttId: string) {
  console.log('\nrunning import…');

  const clientIdByLegalName = new Map<string, string>();
  for (const c of plan.clients) {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.client.findFirst({
        where: { legalName: c.legalName },
        select: { id: true, code: true, legalName: true },
      });
      if (existing) return existing;
      const fresh = await tx.client.create({
        data: {
          code: c.code,
          legalName: c.legalName,
          clientType: 'private_company',
          country: 'AU',
          primaryPartnerId: ttId,
        },
        select: { id: true, code: true, legalName: true },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: ttId },
        action: 'created',
        entity: {
          type: 'client',
          id: fresh.id,
          after: {
            code: fresh.code,
            legalName: fresh.legalName,
            source: 'master_tracker_import',
          },
        },
        source: 'api',
      });
      return fresh;
    });
    clientIdByLegalName.set(c.legalName.toLowerCase(), created.id);
    console.log(`  client ${created.code.padEnd(5)} ${created.legalName}`);
  }

  let createdProjects = 0;
  let skippedProjects = 0;
  for (const p of plan.projects) {
    const clientId = clientIdByLegalName.get(p.clientLegalName.toLowerCase());
    if (!clientId) {
      console.warn(`  skip ${p.code} — client "${p.clientLegalName}" missing`);
      skippedProjects += 1;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const existing = await tx.project.findUnique({ where: { code: p.code } });
      if (existing) {
        skippedProjects += 1;
        return;
      }
      const data: Prisma.ProjectUncheckedCreateInput = {
        code: p.code,
        clientId,
        name: p.name || p.code,
        description: p.description || null,
        stage: p.stage as ProjectStage,
        contractValue: p.contractValueCents,
        startDate: p.startDate ? new Date(p.startDate) : null,
        endDate: p.endDate ? new Date(p.endDate) : null,
        primaryPartnerId: p.matchedPrimaryPartnerId ?? ttId,
        managerId: p.matchedManagerId ?? ttId,
      };
      const fresh = await tx.project.create({ data });
      await writeAudit(tx, {
        actor: { type: 'person', id: ttId },
        action: 'created',
        entity: {
          type: 'project',
          id: fresh.id,
          after: {
            code: fresh.code,
            stage: fresh.stage,
            contractValue: fresh.contractValue,
            source: 'master_tracker_import',
            row: p.rowIndex,
          },
        },
        source: 'api',
      });
      createdProjects += 1;
    });
  }

  console.log(
    `\ncreated ${createdProjects} projects (skipped ${skippedProjects} — already in DB or missing client).`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf('--file');
  const file = fileFlag >= 0 ? args[fileFlag + 1]! : DEFAULT_FILE;
  const doExecute = args.includes('--execute');

  console.log(`source: ${file}`);
  const rows = parseWorkbook(file);
  console.log(`parsed ${rows.length} project rows`);

  const tt = await prisma.person.findUnique({
    where: { email: TT_EMAIL },
    select: { id: true, initials: true },
  });
  if (!tt) throw new Error(`TT (${TT_EMAIL}) not in DB — run cleanup first`);

  const allPeople = await prisma.person.findMany({
    select: { id: true, initials: true },
  });
  const knownInitials = new Map(allPeople.map((p) => [p.initials.toUpperCase(), p.id]));

  const plan = buildPlan(rows, tt.id, knownInitials, file);
  printPlan(plan);
  fs.writeFileSync(PREVIEW_PATH, JSON.stringify(plan, null, 2));
  console.log(`\nfull plan written to ${PREVIEW_PATH}`);

  if (!doExecute) {
    console.log('\n(dry-run — pass --execute to commit to DB)');
    return;
  }
  await execute(plan, tt.id);
}

main()
  .catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
