/**
 * Projects-CSV importer for the reconcile assistant.
 *
 * Accepts a CSV with one row per project. Required headers:
 *   code, name, clientCode
 * Optional headers:
 *   description, contractValue (dollars or "$50,000"), startDate (ISO),
 *   endDate (ISO), actualEndDate (ISO), partnerEmail, managerEmail,
 *   sharepointFolderUrl, sharepointAdminFolderUrl, stage
 *
 * Returns a typed dry-run summary (create / update / skip per row) so
 * the chat panel can render a diff card before the user confirms.
 */
import type { ProjectStage } from '@prisma/client';
import { prisma } from '@/server/db';
import { parseCsv, requireHeaders } from '@/server/imports/csv-parse';

const PROJECT_REQUIRED_HEADERS = ['code', 'name', 'clientcode'] as const;

const VALID_STAGES: ReadonlyArray<ProjectStage> = [
  'kickoff', 'delivery', 'closing', 'archived', 'standing', 'benched',
];

export type ProjectImportRow = {
  /** 1-indexed row number in the source CSV for error messages. */
  lineNo: number;
  /** Discriminator for the diff card. */
  action: 'create' | 'update' | 'skip';
  /** Project code as it appears in the row. */
  code: string;
  /** Lookup status for the client + people referenced. */
  clientCode: string;
  /** Human-readable note — error reason if skip, or the diff summary
   *  ("contractValue 50,000 → 60,000, manager Jas → Anna") on update. */
  note: string;
  /** The validated, ready-to-write data — null when action='skip'. */
  data?: {
    code: string;
    clientId: string;
    name: string;
    description: string | null;
    contractValueCents: number;
    startDate: Date | null;
    endDate: Date | null;
    actualEndDate: Date | null;
    primaryPartnerId: string;
    managerId: string;
    sharepointFolderUrl: string | null;
    sharepointAdminFolderUrl: string | null;
    stage: ProjectStage;
  };
};

export type ProjectImportPlan = {
  rows: ProjectImportRow[];
  counts: { create: number; update: number; skip: number; total: number };
};

/** Parse the CSV text and resolve every row's referenced entities. */
export async function planProjectImport(csvText: string, defaultPartnerId: string): Promise<{
  ok: true;
  plan: ProjectImportPlan;
} | {
  ok: false;
  error: string;
}> {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error.message };
  }
  const missing = requireHeaders(parsed.data, PROJECT_REQUIRED_HEADERS);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required columns: ${missing.join(', ')}. Required: code, name, clientCode.`,
    };
  }

  // Pre-fetch the universe of referenced clients + people in two
  // round-trips so the per-row loop is in-memory.
  const codes = new Set<string>();
  const clientCodes = new Set<string>();
  const emails = new Set<string>();
  for (const r of parsed.data.rows) {
    if (r['code']) codes.add(r['code'].toUpperCase());
    if (r['clientcode']) clientCodes.add(r['clientcode'].toUpperCase());
    if (r['partneremail']) emails.add(r['partneremail'].toLowerCase());
    if (r['manageremail']) emails.add(r['manageremail'].toLowerCase());
  }
  const [existingProjects, clients, people] = await Promise.all([
    codes.size === 0
      ? Promise.resolve([])
      : prisma.project.findMany({
          where: { code: { in: Array.from(codes) } },
          select: {
            id: true, code: true, name: true, description: true,
            contractValue: true, startDate: true, endDate: true,
            actualEndDate: true, primaryPartnerId: true, managerId: true,
            sharepointFolderUrl: true, sharepointAdminFolderUrl: true,
            stage: true, clientId: true,
          },
        }),
    clientCodes.size === 0
      ? Promise.resolve([])
      : prisma.client.findMany({
          where: { code: { in: Array.from(clientCodes) } },
          select: { id: true, code: true },
        }),
    emails.size === 0
      ? Promise.resolve([])
      : prisma.person.findMany({
          where: { email: { in: Array.from(emails), mode: 'insensitive' } },
          select: { id: true, email: true, endDate: true, inactiveAt: true },
        }),
  ]);
  const projectByCode = new Map(existingProjects.map((p) => [p.code.toUpperCase(), p]));
  const clientByCode = new Map(clients.map((c) => [c.code.toUpperCase(), c.id]));
  const personByEmail = new Map<string, { id: string; active: boolean }>();
  for (const p of people) {
    if (p.email) {
      personByEmail.set(p.email.toLowerCase(), {
        id: p.id,
        active: p.endDate === null && p.inactiveAt === null,
      });
    }
  }

  const rows: ProjectImportRow[] = [];
  let lineNo = 1; // accounting for header row
  for (const r of parsed.data.rows) {
    lineNo += 1;
    const code = (r['code'] || '').toUpperCase().trim();
    const clientCode = (r['clientcode'] || '').toUpperCase().trim();
    const skip = (note: string): ProjectImportRow => ({
      lineNo, action: 'skip', code, clientCode, note,
    });

    if (!code) {
      rows.push(skip('code is empty.'));
      continue;
    }
    if (!r['name']) {
      rows.push(skip('name is empty.'));
      continue;
    }
    if (!clientCode) {
      rows.push(skip('clientCode is empty.'));
      continue;
    }
    const clientId = clientByCode.get(clientCode);
    if (!clientId) {
      rows.push(skip(`Unknown client code "${clientCode}". Create the client first.`));
      continue;
    }

    // Contract value — accepts "50000", "50,000", "$50,000", "50000.00".
    let contractValueCents = 0;
    if (r['contractvalue']) {
      const num = Number(r['contractvalue'].replace(/[,$]/g, ''));
      if (!Number.isFinite(num) || num < 0) {
        rows.push(skip(`contractValue "${r['contractvalue']}" unparseable.`));
        continue;
      }
      contractValueCents = Math.round(num * 100);
    }

    // Date parsing.
    function parseDate(name: 'startdate' | 'enddate' | 'actualenddate'): Date | null | 'error' {
      const raw = r[name];
      if (!raw || raw.toLowerCase() === 'null') return null;
      const d = new Date(raw);
      if (!Number.isFinite(d.getTime())) return 'error';
      return d;
    }
    const startDate = parseDate('startdate');
    if (startDate === 'error') { rows.push(skip('startDate unparseable.')); continue; }
    const endDate = parseDate('enddate');
    if (endDate === 'error') { rows.push(skip('endDate unparseable.')); continue; }
    const actualEndDate = parseDate('actualenddate');
    if (actualEndDate === 'error') { rows.push(skip('actualEndDate unparseable.')); continue; }

    // Lead resolution — partnerEmail / managerEmail. Default to TT (the
    // import-runner's super-admin id) when unspecified.
    let primaryPartnerId = defaultPartnerId;
    if (r['partneremail']) {
      const p = personByEmail.get(r['partneremail'].toLowerCase());
      if (!p) { rows.push(skip(`Unknown partnerEmail "${r['partneremail']}".`)); continue; }
      if (!p.active) { rows.push(skip(`partnerEmail "${r['partneremail']}" is inactive.`)); continue; }
      primaryPartnerId = p.id;
    }
    let managerId = defaultPartnerId;
    if (r['manageremail']) {
      const p = personByEmail.get(r['manageremail'].toLowerCase());
      if (!p) { rows.push(skip(`Unknown managerEmail "${r['manageremail']}".`)); continue; }
      if (!p.active) { rows.push(skip(`managerEmail "${r['manageremail']}" is inactive.`)); continue; }
      managerId = p.id;
    }

    // Stage.
    let stage: ProjectStage = 'kickoff';
    if (r['stage']) {
      const s = r['stage'].toLowerCase().trim();
      if (!(VALID_STAGES as ReadonlyArray<string>).includes(s)) {
        rows.push(skip(`stage "${r['stage']}" not one of ${VALID_STAGES.join(', ')}.`));
        continue;
      }
      stage = s as ProjectStage;
    }

    const data = {
      code,
      clientId,
      name: r['name'].trim(),
      description: r['description'] ? r['description'].trim() : null,
      contractValueCents,
      startDate,
      endDate,
      actualEndDate,
      primaryPartnerId,
      managerId,
      sharepointFolderUrl: r['sharepointfolderurl'] || null,
      sharepointAdminFolderUrl: r['sharepointadminfolderurl'] || null,
      stage,
    };

    const existing = projectByCode.get(code);
    if (existing) {
      // Build a diff summary listing only changed fields. Cheap UX win.
      const diffs: string[] = [];
      if (existing.name !== data.name) diffs.push(`name → "${data.name}"`);
      if (existing.contractValue !== data.contractValueCents) {
        diffs.push(`contractValue → AUD ${(data.contractValueCents / 100).toLocaleString('en-AU')}`);
      }
      if (existing.stage !== data.stage) diffs.push(`stage → ${data.stage}`);
      if (existing.primaryPartnerId !== data.primaryPartnerId) diffs.push('partner →');
      if (existing.managerId !== data.managerId) diffs.push('manager →');
      // Date diff (loose match — string equality on ISO date).
      function dayKey(d: Date | null): string { return d ? d.toISOString().slice(0, 10) : ''; }
      if (dayKey(existing.startDate) !== dayKey(data.startDate)) diffs.push(`startDate → ${dayKey(data.startDate) || '—'}`);
      if (dayKey(existing.endDate) !== dayKey(data.endDate)) diffs.push(`endDate → ${dayKey(data.endDate) || '—'}`);
      if (dayKey(existing.actualEndDate) !== dayKey(data.actualEndDate)) {
        diffs.push(`actualEndDate → ${dayKey(data.actualEndDate) || '—'}`);
      }
      if (diffs.length === 0) {
        rows.push({ lineNo, action: 'skip', code, clientCode, note: 'No changes — row matches existing.' });
        continue;
      }
      rows.push({ lineNo, action: 'update', code, clientCode, note: diffs.join(', '), data });
    } else {
      rows.push({
        lineNo, action: 'create', code, clientCode,
        note: `${data.name} · ${data.stage} · AUD ${(data.contractValueCents / 100).toLocaleString('en-AU')}`,
        data,
      });
    }
  }

  const counts = {
    create: rows.filter((r) => r.action === 'create').length,
    update: rows.filter((r) => r.action === 'update').length,
    skip: rows.filter((r) => r.action === 'skip').length,
    total: rows.length,
  };
  return { ok: true, plan: { rows, counts } };
}
