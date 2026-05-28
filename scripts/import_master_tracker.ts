/**
 * Phase 2 — Parse the Foundry Health Master Project Tracker workbook
 * and upsert Clients + Projects.
 *
 *   pnpm tsx scripts/import_master_tracker.ts                # dry-run (default)
 *   pnpm tsx scripts/import_master_tracker.ts --execute      # commit to DB
 *   pnpm tsx scripts/import_master_tracker.ts --file ~/Downloads/foo.xlsx
 *
 * Single sheet `Commercial Master Tracker` carries every FY's projects.
 * Header row is row 1 (zero-indexed); FY separator rows have the FY
 * label in column A (e.g. "FY 24-25") and no other content.
 *
 * Header layout (must match):
 *   B Client | C Project Code | D Project Name | E Description
 *   F Start date | G End date | H Gross Revenue (AUD, ex GST)
 *   I Status (outstanding) | J Referral | K Project leads
 *
 * Live-vs-archived cutoff is date-based:
 *   startDate >= 2025-07-01 → live (stage = delivery, kickoff, or closing)
 *   startDate <  2025-07-01 → archived
 *   no startDate            → live by default (flagged for TT)
 *
 * Duplicate project codes: last occurrence wins (the tracker repeats a
 * code when a project is updated across FYs — only ADV002 today).
 *
 * Partner / manager matching: parses "Project leads" cell of the form
 * "TT/MB" → primary TT, manager MB (falls back to primary). Initials
 * matched against Person.initials. Anything that doesn't match falls
 * back to TT and is logged in the manual-review list.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
import { PrismaClient, ProjectStage, type Prisma } from '@prisma/client';
import { writeAudit } from '@/server/audit';

const prisma = new PrismaClient();
const TT_EMAIL = 'trung@foundry.health';
const CUTOFF = new Date('2025-07-01T00:00:00Z');
const SHEET_NAME = 'Commercial Master Tracker';
const DEFAULT_FILE = path.join(
  process.env.HOME ?? '',
  'Downloads',
  'Foundry Health Master Project Tracker.xlsx',
);
const PREVIEW_PATH = '/tmp/import-preview.json';

// Client legal-name normalisation. Keep in sync with the existing
// import-clients-from-master-tracker.ts canonicals.
const NAME_OVERRIDES: Record<string, string> = {
  genesiscare: 'GenesisCare', // collapses "Genesiscare" rows
};

type ParsedRow = {
  rowIndex: number;
  sectionFy: string;
  clientLegalName: string;
  code: string;
  name: string;
  description: string;
  startDate: Date | null;
  endDate: Date | null;
  contractValueCents: number;
  outstandingRaw: string | null;
  referralInitials: string[];
  leadInitials: string[];
};

function parseCurrencyToCents(raw: unknown): number {
  if (typeof raw === 'number') return Math.round(raw * 100);
  if (typeof raw !== 'string') return 0;
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function parseInitials(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\/,&\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length >= 2 && s.length <= 4);
}

function deriveCode(name: string, taken: Set<string>): string {
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

function normaliseClientName(raw: string): string {
  const trimmed = raw.trim();
  return NAME_OVERRIDES[trimmed.toLowerCase()] ?? trimmed;
}

function parseWorkbook(file: string): ParsedRow[] {
  if (!fs.existsSync(file)) {
    throw new Error(`workbook not found: ${file}`);
  }
  const wb = XLSX.readFile(file, { cellDates: true });
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new Error(
      `sheet "${SHEET_NAME}" not in workbook. Found: ${wb.SheetNames.join(', ')}`,
    );
  }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    raw: true,
    defval: null,
  });

  let sectionFy = '(pre-header)';
  const rows: ParsedRow[] = [];
  for (let i = 2; i < aoa.length; i += 1) {
    // row 0 = title block; row 1 = header
    const r = aoa[i] ?? [];
    const a = r[0];
    if (typeof a === 'string' && /FY\s*\d/i.test(a)) {
      sectionFy = a.trim();
      continue;
    }
    const clientRaw = typeof r[1] === 'string' ? r[1].trim() : '';
    const codeRaw = typeof r[2] === 'string' ? r[2].trim() : '';
    if (!clientRaw && !codeRaw) continue; // blank / totals row
    if (!clientRaw || !codeRaw) {
      // partial — log to import summary but skip
      console.warn(
        `r${i}: skipping — needs both client + code (got client="${clientRaw}", code="${codeRaw}")`,
      );
      continue;
    }
    const startDate = r[5] instanceof Date ? (r[5] as Date) : null;
    const endDate = r[6] instanceof Date ? (r[6] as Date) : null;
    rows.push({
      rowIndex: i,
      sectionFy,
      clientLegalName: normaliseClientName(clientRaw),
      code: codeRaw.toUpperCase(),
      name: typeof r[3] === 'string' ? r[3].trim() : String(r[3] ?? '').trim(),
      description: typeof r[4] === 'string' ? r[4].trim() : '',
      startDate,
      endDate,
      contractValueCents: parseCurrencyToCents(r[7]),
      outstandingRaw: r[8] === null ? null : String(r[8]),
      referralInitials: parseInitials(r[9]),
      leadInitials: parseInitials(r[10]),
    });
  }
  return rows;
}

function decideStage(row: ParsedRow): ProjectStage {
  // Date-based cut. No date defaults to live (kickoff).
  if (!row.startDate) return ProjectStage.kickoff;
  if (row.startDate < CUTOFF) return ProjectStage.archived;
  const out = row.outstandingRaw?.toLowerCase().trim() ?? '';
  if (out === 'acquitted') return ProjectStage.closing;
  // numeric outstanding → live; treat 0 as wrapping-up (closing).
  const n = Number(out.replace(/[^0-9.\-]/g, ''));
  if (Number.isFinite(n) && n === 0) return ProjectStage.closing;
  return ProjectStage.delivery;
}

function deriveClientCode(name: string, taken: Set<string>): string {
  return deriveCode(name, taken);
}

type ImportPlan = {
  generatedAt: string;
  workbookPath: string;
  summary: {
    totalRows: number;
    distinctClients: number;
    liveProjects: number;
    archivedProjects: number;
    duplicateCodes: Array<{ code: string; rows: number[]; chose: number }>;
    unmatchedInitials: string[];
    rowsWithoutStartDate: number[];
    rowsWithoutContractValue: number[];
  };
  clients: Array<{
    legalName: string;
    code: string;
    projectCount: number;
  }>;
  projects: Array<{
    rowIndex: number;
    code: string;
    clientLegalName: string;
    name: string;
    contractValueCents: number;
    startDate: string | null;
    endDate: string | null;
    stage: ProjectStage;
    primaryPartnerInitials: string | null;
    managerInitials: string | null;
    matchedPrimaryPartnerId: string | null;
    matchedManagerId: string | null;
    fallbackToTt: boolean;
  }>;
};

async function buildPlan(
  rows: ParsedRow[],
  ttId: string,
  knownInitials: Map<string, string>,
  workbookPath: string,
): Promise<ImportPlan> {
  // De-duplicate codes — last occurrence wins.
  const codeFirstIndex = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const list = codeFirstIndex.get(rows[i]!.code) ?? [];
    list.push(rows[i]!.rowIndex);
    codeFirstIndex.set(rows[i]!.code, list);
  }
  const duplicateCodes: Array<{ code: string; rows: number[]; chose: number }> = [];
  const lastIdxByCode = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 1) lastIdxByCode.set(rows[i]!.code, i);

  const winners = new Set(lastIdxByCode.values());
  const collapsedRows: ParsedRow[] = rows.filter((_, i) => winners.has(i));
  for (const [code, rowList] of codeFirstIndex) {
    if (rowList.length > 1) {
      const winnerRow = collapsedRows.find((r) => r.code === code)!.rowIndex;
      duplicateCodes.push({ code, rows: rowList, chose: winnerRow });
    }
  }

  // Client list — collect first project's code as the client prefix (mirroring
  // the existing import logic). Manual fallbacks if no prefix found.
  const byClient = new Map<
    string,
    { legalName: string; clientCodes: Set<string>; rows: ParsedRow[] }
  >();
  for (const r of collapsedRows) {
    const key = r.clientLegalName.toLowerCase();
    const entry = byClient.get(key) ?? {
      legalName: r.clientLegalName,
      clientCodes: new Set<string>(),
      rows: [],
    };
    const match = r.code.match(/^[A-Z]+/);
    if (match && match[0].length >= 2) entry.clientCodes.add(match[0]);
    entry.rows.push(r);
    byClient.set(key, entry);
  }

  const takenCodes = new Set<string>();
  const clientCodeByLegalName = new Map<string, string>();
  const clientsPlan: ImportPlan['clients'] = [];
  for (const [, info] of byClient) {
    const codeFromTracker = [...info.clientCodes][0];
    let code = (codeFromTracker ?? '').toUpperCase();
    if (!code) code = deriveClientCode(info.legalName, takenCodes);
    while (takenCodes.has(code)) {
      code = deriveClientCode(info.legalName, takenCodes);
    }
    takenCodes.add(code);
    clientCodeByLegalName.set(info.legalName.toLowerCase(), code);
    clientsPlan.push({
      legalName: info.legalName,
      code,
      projectCount: info.rows.length,
    });
  }

  const unmatchedInitials = new Set<string>();
  const rowsWithoutStartDate: number[] = [];
  const rowsWithoutContractValue: number[] = [];
  let live = 0;
  let archived = 0;

  const projectsPlan: ImportPlan['projects'] = collapsedRows.map((r) => {
    if (!r.startDate) rowsWithoutStartDate.push(r.rowIndex);
    if (!r.contractValueCents) rowsWithoutContractValue.push(r.rowIndex);
    const stage = decideStage(r);
    if (stage === ProjectStage.archived) archived += 1;
    else live += 1;

    const primaryInit = r.leadInitials[0] ?? null;
    const managerInit = r.leadInitials[1] ?? primaryInit;
    const matchedPrimary = primaryInit ? (knownInitials.get(primaryInit) ?? null) : null;
    const matchedManager = managerInit ? (knownInitials.get(managerInit) ?? null) : null;
    if (primaryInit && !matchedPrimary) unmatchedInitials.add(primaryInit);
    if (managerInit && !matchedManager) unmatchedInitials.add(managerInit);
    return {
      rowIndex: r.rowIndex,
      code: r.code,
      clientLegalName: r.clientLegalName,
      name: r.name,
      contractValueCents: r.contractValueCents,
      startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null,
      endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
      stage,
      primaryPartnerInitials: primaryInit,
      managerInitials: managerInit,
      matchedPrimaryPartnerId: matchedPrimary ?? ttId,
      matchedManagerId: matchedManager ?? ttId,
      fallbackToTt: !matchedPrimary || !matchedManager,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    workbookPath,
    summary: {
      totalRows: rows.length,
      distinctClients: clientsPlan.length,
      liveProjects: live,
      archivedProjects: archived,
      duplicateCodes,
      unmatchedInitials: [...unmatchedInitials].sort(),
      rowsWithoutStartDate,
      rowsWithoutContractValue,
    },
    clients: clientsPlan,
    projects: projectsPlan,
  };
}

function printPlan(plan: ImportPlan) {
  console.log('\n══ IMPORT PLAN ═════════════════════════════════════════');
  console.log(`workbook : ${plan.workbookPath}`);
  console.log(`rows     : ${plan.summary.totalRows}`);
  console.log(
    `clients  : ${plan.summary.distinctClients}   projects: ${plan.projects.length} ` +
      `(live ${plan.summary.liveProjects}, archived ${plan.summary.archivedProjects})`,
  );

  if (plan.summary.duplicateCodes.length) {
    console.log(`\nduplicate codes (kept last occurrence):`);
    for (const d of plan.summary.duplicateCodes) {
      console.log(`  ${d.code.padEnd(10)} rows ${d.rows.join(',')} → chose r${d.chose}`);
    }
  }
  if (plan.summary.unmatchedInitials.length) {
    console.log(
      `\nunmatched initials (defaulted to TT): ${plan.summary.unmatchedInitials.join(' ')}`,
    );
  }
  if (plan.summary.rowsWithoutStartDate.length) {
    console.log(`rows without startDate: ${plan.summary.rowsWithoutStartDate.join(',')}`);
  }
  if (plan.summary.rowsWithoutContractValue.length) {
    console.log(
      `rows without contract value (will import as 0): ${plan.summary.rowsWithoutContractValue.join(',')}`,
    );
  }

  console.log(`\nclients (${plan.clients.length}):`);
  for (const c of [...plan.clients].sort((a, b) => a.legalName.localeCompare(b.legalName))) {
    console.log(`  ${c.code.padEnd(5)} ${c.legalName.padEnd(40)} ${c.projectCount} projects`);
  }

  console.log(`\nsample projects (first 5 live, first 3 archived):`);
  const liveSample = plan.projects.filter((p) => p.stage !== 'archived').slice(0, 5);
  const archSample = plan.projects.filter((p) => p.stage === 'archived').slice(0, 3);
  for (const p of [...liveSample, ...archSample]) {
    const dollars = (p.contractValueCents / 100).toLocaleString('en-AU');
    console.log(
      `  ${p.code.padEnd(10)} ${p.stage.padEnd(9)} $${dollars.padStart(10)} ${
        p.startDate ?? '----'
      } ${p.clientLegalName.padEnd(28)} ${p.name.slice(0, 40)}`,
    );
  }
}

async function execute(plan: ImportPlan, ttId: string) {
  console.log('\nrunning import…');

  // Upsert clients first
  const clientIdByLegalName = new Map<string, string>();
  for (const c of plan.clients) {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.client.findFirst({
        where: { legalName: c.legalName },
        select: { id: true, code: true, legalName: true },
      });
      if (existing) return existing;
      const newClient = await tx.client.create({
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
          id: newClient.id,
          after: { code: newClient.code, legalName: newClient.legalName, source: 'master_tracker_import' },
        },
        source: 'api',
      });
      return newClient;
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
        description: p.code !== p.name ? p.name : null,
        stage: p.stage,
        contractValue: p.contractValueCents,
        startDate: p.startDate ? new Date(p.startDate) : null,
        endDate: p.endDate ? new Date(p.endDate) : null,
        primaryPartnerId: p.matchedPrimaryPartnerId ?? ttId,
        managerId: p.matchedManagerId ?? ttId,
      };
      const created = await tx.project.create({ data });
      await writeAudit(tx, {
        actor: { type: 'person', id: ttId },
        action: 'created',
        entity: {
          type: 'project',
          id: created.id,
          after: {
            code: created.code,
            stage: created.stage,
            contractValue: created.contractValue,
            source: 'master_tracker_import',
            row: p.rowIndex,
          },
        },
        source: 'api',
      });
      createdProjects += 1;
    });
  }

  console.log(`\ncreated ${createdProjects} projects (skipped ${skippedProjects} — already in DB or missing client).`);
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

  const plan = await buildPlan(rows, tt.id, knownInitials, file);
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
