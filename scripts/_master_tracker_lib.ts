/**
 * Shared parse + plan-build for the Foundry Health Master Project
 * Tracker import. Pure functions — no Prisma import — so we can
 * dry-run without a DB.
 */
import * as fs from 'node:fs';
import * as XLSX from 'xlsx';

export const SHEET_NAME = 'Commercial Master Tracker';
export const CUTOFF = new Date('2025-07-01T00:00:00Z');

export const NAME_OVERRIDES: Record<string, string> = {
  genesiscare: 'GenesisCare',
};

export type ProjectStageStr =
  | 'kickoff'
  | 'delivery'
  | 'closing'
  | 'archived'
  | 'standing'
  | 'benched';

export type ParsedRow = {
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

export type ImportPlan = {
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
  clients: Array<{ legalName: string; code: string; projectCount: number }>;
  projects: Array<{
    rowIndex: number;
    code: string;
    clientLegalName: string;
    name: string;
    description: string;
    contractValueCents: number;
    startDate: string | null;
    endDate: string | null;
    stage: ProjectStageStr;
    primaryPartnerInitials: string | null;
    managerInitials: string | null;
    matchedPrimaryPartnerId: string | null;
    matchedManagerId: string | null;
    fallbackToTt: boolean;
  }>;
};

export function parseCurrencyToCents(raw: unknown): number {
  if (typeof raw === 'number') return Math.round(raw * 100);
  if (typeof raw !== 'string') return 0;
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function parseInitials(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(/[\/,&\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length >= 2 && s.length <= 4);
}

export function deriveCode(name: string, taken: Set<string>): string {
  const cleaned = name.replace(/[^a-zA-Z\s]/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const base = (words.slice(0, 3).map((w) => w[0]).join('') || 'CLI')
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

export function normaliseClientName(raw: string): string {
  const trimmed = raw.trim();
  return NAME_OVERRIDES[trimmed.toLowerCase()] ?? trimmed;
}

export function parseWorkbook(file: string): ParsedRow[] {
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
    const r = aoa[i] ?? [];
    const a = r[0];
    if (typeof a === 'string' && /FY\s*\d/i.test(a)) {
      sectionFy = a.trim();
      continue;
    }
    const clientRaw = typeof r[1] === 'string' ? r[1].trim() : '';
    const codeRaw = typeof r[2] === 'string' ? r[2].trim() : '';
    if (!clientRaw && !codeRaw) continue;
    if (!clientRaw || !codeRaw) {
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
      // Strip stray whitespace inside codes ("PCP 001" → "PCP001"). Keep
      // hyphens since IFM001-1 / IFM001-2 are phase suffixes used as
      // distinct project codes in the tracker.
      code: codeRaw.toUpperCase().replace(/\s+/g, ''),
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

export function decideStage(row: ParsedRow): ProjectStageStr {
  if (!row.startDate) return 'kickoff';
  if (row.startDate < CUTOFF) return 'archived';
  const out = row.outstandingRaw?.toLowerCase().trim() ?? '';
  if (out === 'acquitted') return 'closing';
  const n = Number(out.replace(/[^0-9.\-]/g, ''));
  if (Number.isFinite(n) && n === 0) return 'closing';
  return 'delivery';
}

export function buildPlan(
  rows: ParsedRow[],
  ttId: string,
  knownInitials: Map<string, string>,
  workbookPath: string,
): ImportPlan {
  // Duplicate codes — last occurrence wins.
  const rowsByCode = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const list = rowsByCode.get(rows[i]!.code) ?? [];
    list.push(rows[i]!.rowIndex);
    rowsByCode.set(rows[i]!.code, list);
  }
  const lastIdxByCode = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 1) lastIdxByCode.set(rows[i]!.code, i);
  const winners = new Set(lastIdxByCode.values());
  const collapsedRows: ParsedRow[] = rows.filter((_, i) => winners.has(i));
  const duplicateCodes: ImportPlan['summary']['duplicateCodes'] = [];
  for (const [code, rowList] of rowsByCode) {
    if (rowList.length > 1) {
      const winnerRow = collapsedRows.find((r) => r.code === code)!.rowIndex;
      duplicateCodes.push({ code, rows: rowList, chose: winnerRow });
    }
  }

  // Client roll-up + client-code derivation
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
  const clientsPlan: ImportPlan['clients'] = [];
  for (const [, info] of byClient) {
    const codeFromTracker = [...info.clientCodes][0];
    let code = (codeFromTracker ?? '').toUpperCase();
    if (!code) code = deriveCode(info.legalName, takenCodes);
    while (takenCodes.has(code)) code = deriveCode(info.legalName, takenCodes);
    takenCodes.add(code);
    clientsPlan.push({ legalName: info.legalName, code, projectCount: info.rows.length });
  }

  // Project rows + matching
  const unmatchedInitials = new Set<string>();
  const rowsWithoutStartDate: number[] = [];
  const rowsWithoutContractValue: number[] = [];
  let live = 0;
  let archived = 0;
  const projectsPlan: ImportPlan['projects'] = collapsedRows.map((r) => {
    if (!r.startDate) rowsWithoutStartDate.push(r.rowIndex);
    if (!r.contractValueCents) rowsWithoutContractValue.push(r.rowIndex);
    const stage = decideStage(r);
    if (stage === 'archived') archived += 1;
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
      description: r.description,
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

export function printPlan(plan: ImportPlan) {
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
    console.log(
      `  ${c.code.padEnd(5)} ${c.legalName.padEnd(40)} ${c.projectCount} projects`,
    );
  }
  console.log(`\nsample projects (first 5 live, first 3 archived):`);
  const live = plan.projects.filter((p) => p.stage !== 'archived').slice(0, 5);
  const arch = plan.projects.filter((p) => p.stage === 'archived').slice(0, 3);
  for (const p of [...live, ...arch]) {
    const dollars = (p.contractValueCents / 100).toLocaleString('en-AU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    console.log(
      `  ${p.code.padEnd(10)} ${p.stage.padEnd(9)} $${dollars.padStart(13)} ${
        p.startDate ?? '----------'
      } ${p.clientLegalName.padEnd(28)} ${p.name.slice(0, 40)}`,
    );
  }
}
