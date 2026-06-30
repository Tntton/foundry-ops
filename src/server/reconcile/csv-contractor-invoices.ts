/**
 * ContractorInvoice importer — historical aggregated contractor cost
 * from the FY26 master tracker's Tab 1 (corrected block).
 *
 * Required headers: consultant, projectCode, billableHours, invoicedExGst
 * Optional: role, gst, invoicePeriod, notes
 *
 * Person resolution: by full-name match against the Team Details roster.
 * Rows where no Person matches return action='skip' with a guiding note
 * (run people CSV first).
 *
 * Code remaps (TT 2026-06-30):
 *   ADA001 → FHP001 (ADA001 abandoned; FHP001 = all internal primer work)
 *   BONUS / blank → FHX000 (catch-all; reassign later)
 */
import { prisma } from '@/server/db';
import { parseCsv, requireHeaders } from '@/server/imports/csv-parse';

const REQUIRED_HEADERS = ['consultant', 'projectcode', 'billablehours', 'invoicedexgst'] as const;

/**
 * Code remap table. Applied BEFORE project lookup so the source
 * spreadsheet stays untouched but lands on the correct row.
 */
const CODE_REMAP: Record<string, string> = {
  ADA001: 'FHP001', // ADA001 retired; FHP001 = internal primer catch-all
};

/**
 * Codes that should always route to FHX000 (the BD / Other catch-all).
 * Empty project-code cells get the same treatment.
 */
const REROUTE_TO_FHX = new Set(['BONUS', '']);

export type ContractorInvoiceImportRow = {
  lineNo: number;
  action: 'create' | 'skip';
  consultant: string;
  projectCode: string;
  note: string;
  data?: {
    personId: string;
    projectId: string;
    hours: number;
    amountExGst: number; // cents
    gst: number; // cents
    periodLabel: string;
    periodAnchor: Date;
    roleOnInvoice: string | null;
    notes: string | null;
  };
};

export type ContractorInvoiceImportPlan = {
  rows: ContractorInvoiceImportRow[];
  counts: { create: number; skip: number; total: number };
  /** Aggregates so the diff card surfaces what'll land in the DB. */
  totals: { hours: number; amountExGst: number };
};

/**
 * Parse the fuzzy `Invoice Period` string into an anchor date. Examples:
 *   "23/11/2025"               → 2025-11-23
 *   "Jul-25"                   → 2025-07-01
 *   "Jul 2025 – Jun 2026"      → 2025-07-01 (start of range)
 *   "Aug 2025 – Jun 2026"      → 2025-08-01
 *   "" or "TBC"                → fallback (today's date)
 */
function parsePeriodAnchor(raw: string): Date {
  const v = (raw ?? '').trim();
  if (!v) return new Date();

  // DD/MM/YYYY or D/M/YYYY
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    if (Number.isFinite(d.getTime())) return d;
  }

  // ISO YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) {
    const d = new Date(`${v}T00:00:00Z`);
    if (Number.isFinite(d.getTime())) return d;
  }

  // "Jul-25" / "Aug-26" (short month, 2-digit year)
  const monthShort = /^([A-Za-z]{3})-(\d{2})$/.exec(v);
  if (monthShort) {
    const [, mon, yy] = monthShort;
    const monthIdx = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
      .indexOf(mon!.toLowerCase());
    if (monthIdx !== -1) {
      return new Date(Date.UTC(2000 + Number(yy), monthIdx, 1));
    }
  }

  // "Jul 2025 – Jun 2026" or "Jul 2025 - Jun 2026" — take the start.
  const range = /^([A-Za-z]{3,9})\s+(\d{4})\s*[–\-]\s*[A-Za-z]{3,9}\s+\d{4}$/.exec(v);
  if (range) {
    const [, mon, yyyy] = range;
    const monthIdx = monthIndex(mon!);
    if (monthIdx !== -1) {
      return new Date(Date.UTC(Number(yyyy), monthIdx, 1));
    }
  }

  // "Jul 2025" — single month + 4-digit year
  const monthLong = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(v);
  if (monthLong) {
    const [, mon, yyyy] = monthLong;
    const monthIdx = monthIndex(mon!);
    if (monthIdx !== -1) return new Date(Date.UTC(Number(yyyy), monthIdx, 1));
  }

  // Fallback — anchor to today so the row at least lands. Notes column
  // will preserve the original string.
  return new Date();
}

function monthIndex(name: string): number {
  return [
    'jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec',
    'january','february','march','april','may','june','july','august','september','october','november','december',
  ].indexOf(name.toLowerCase()) % 12;
}

export async function planContractorInvoiceImport(csvText: string): Promise<{
  ok: true;
  plan: ContractorInvoiceImportPlan;
} | {
  ok: false;
  error: string;
}> {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return { ok: false, error: parsed.error.message };
  const missing = requireHeaders(parsed.data, REQUIRED_HEADERS);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required columns: ${missing.join(', ')}. Required: consultant, projectCode, billableHours, invoicedExGst.`,
    };
  }

  // Pre-fetch the universe of people + projects.
  const names = new Set<string>();
  const codes = new Set<string>();
  for (const r of parsed.data.rows) {
    if (r['consultant']) names.add(r['consultant'].trim());
    const codeRaw = (r['projectcode'] || '').trim().toUpperCase();
    const remapped = CODE_REMAP[codeRaw] ?? (REROUTE_TO_FHX.has(codeRaw) ? 'FHX000' : codeRaw);
    if (remapped) codes.add(remapped);
  }
  // FHX000 always needed as a fallback target.
  codes.add('FHX000');

  const [people, projects] = await Promise.all([
    names.size === 0
      ? Promise.resolve([])
      : prisma.person.findMany({
          where: {
            OR: Array.from(names).map((n) => {
              const [first, ...rest] = n.split(/\s+/);
              return {
                firstName: { equals: first, mode: 'insensitive' as const },
                lastName: { equals: rest.join(' '), mode: 'insensitive' as const },
              };
            }),
          },
          select: { id: true, firstName: true, lastName: true },
        }),
    prisma.project.findMany({
      where: { code: { in: Array.from(codes) } },
      select: { id: true, code: true },
    }),
  ]);
  const personByName = new Map<string, string>();
  for (const p of people) {
    personByName.set(`${p.firstName} ${p.lastName}`.toLowerCase(), p.id);
  }
  const projectByCode = new Map(projects.map((p) => [p.code.toUpperCase(), p.id]));

  const rows: ContractorInvoiceImportRow[] = [];
  let lineNo = 1;
  let totalHours = 0;
  let totalAmount = 0;
  for (const r of parsed.data.rows) {
    lineNo += 1;
    const consultant = (r['consultant'] || '').trim();
    const projectCodeRaw = (r['projectcode'] || '').trim().toUpperCase();
    const projectCode = CODE_REMAP[projectCodeRaw] ?? (REROUTE_TO_FHX.has(projectCodeRaw) ? 'FHX000' : projectCodeRaw);

    const skip = (note: string): ContractorInvoiceImportRow => ({
      lineNo, action: 'skip', consultant, projectCode, note,
    });

    if (!consultant) {
      rows.push(skip('consultant empty.'));
      continue;
    }
    const personId = personByName.get(consultant.toLowerCase());
    if (!personId) {
      rows.push(skip(`No Person matches "${consultant}" — import people CSV first.`));
      continue;
    }
    const projectId = projectByCode.get(projectCode);
    if (!projectId) {
      rows.push(skip(`No project with code "${projectCode}" (remap from "${projectCodeRaw}"). Create the project first.`));
      continue;
    }

    const hoursRaw = Number(r['billablehours'] ?? 0);
    if (!Number.isFinite(hoursRaw) || hoursRaw < 0) {
      rows.push(skip(`billableHours "${r['billablehours']}" unparseable.`));
      continue;
    }
    const amountRaw = Number((r['invoicedexgst'] ?? '0').toString().replace(/[,$\s]/g, ''));
    if (!Number.isFinite(amountRaw) || amountRaw < 0) {
      rows.push(skip(`invoicedExGst "${r['invoicedexgst']}" unparseable.`));
      continue;
    }
    const amountExGst = Math.round(amountRaw * 100);

    const gstRaw = Number((r['gst'] ?? '0').toString().replace(/[,$\s]/g, ''));
    const gst = Number.isFinite(gstRaw) && gstRaw >= 0 ? Math.round(gstRaw * 100) : 0;

    const periodLabel = (r['invoiceperiod'] ?? '').trim();
    const periodAnchor = parsePeriodAnchor(periodLabel);

    if (hoursRaw === 0 && amountExGst === 0) {
      rows.push(skip('Both hours and amount are zero — nothing to import.'));
      continue;
    }

    const remapped = projectCode !== projectCodeRaw ? ` (remapped from ${projectCodeRaw})` : '';
    rows.push({
      lineNo,
      action: 'create',
      consultant,
      projectCode,
      note: `${consultant} → ${projectCode}${remapped} · ${hoursRaw}h · AUD ${amountRaw.toLocaleString('en-AU')} ex-GST · ${periodLabel || '(no period)'}`,
      data: {
        personId,
        projectId,
        hours: hoursRaw,
        amountExGst,
        gst,
        periodLabel: periodLabel || '(unspecified)',
        periodAnchor,
        roleOnInvoice: r['role']?.trim() || null,
        notes: r['notes']?.trim() || null,
      },
    });
    totalHours += hoursRaw;
    totalAmount += amountExGst;
  }

  const counts = {
    create: rows.filter((r) => r.action === 'create').length,
    skip: rows.filter((r) => r.action === 'skip').length,
    total: rows.length,
  };
  return {
    ok: true,
    plan: { rows, counts, totals: { hours: totalHours, amountExGst: totalAmount } },
  };
}
