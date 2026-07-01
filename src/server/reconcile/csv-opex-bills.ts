/**
 * OPEX → Bill importer. Ingests the FY26 master tracker's "Master OPEX
 * Tracker (FH-series)" sheet — every itemised firm-overhead expense.
 *
 * Required headers: chargeCode, item, amount
 * Optional: atoCategory, supplier, issueDate, gst, notes
 *
 * Each row creates one Bill row tagged to the matching project — the
 * chargeCode IS the projectCode (FHB000, FHO000, FHX000, FHP000, or a
 * client-allocated code like GNC001 / ADV002).
 *
 * TT 2026-06-30 remaps:
 *   ADA001 → FHP001
 *   Empty / unrecognised → FHX000
 *
 * Bills land status='approved' since these are historical, pre-platform
 * spend; the normal /approvals workflow doesn't apply.
 */
import type { BillStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { parseCsv, requireHeaders } from '@/server/imports/csv-parse';

const REQUIRED_HEADERS = ['chargecode', 'item', 'amount'] as const;

const CODE_REMAP: Record<string, string> = {
  ADA001: 'FHP001',
};

export type OpexBillImportRow = {
  lineNo: number;
  action: 'create' | 'skip';
  chargeCode: string;
  note: string;
  data?: {
    projectId: string;
    supplierName: string;
    category: string;
    amountTotal: number; // cents inc GST
    gst: number; // cents
    issueDate: Date;
    dueDate: Date;
    notes: string | null;
    status: BillStatus;
  };
};

export type OpexBillImportPlan = {
  rows: OpexBillImportRow[];
  counts: { create: number; skip: number; total: number };
  totals: { amount: number };
};

/**
 * Historical-import fallback when an OPEX row has no parseable
 * issueDate. Anchors to end of FY26 so unparseable historical rows
 * stay in the FY they belong to (was `new Date()`, which leaked rows
 * imported on/after 1 Jul 2026 into the FY27 tab).
 */
const HISTORICAL_ISSUE_FALLBACK = new Date(Date.UTC(2026, 5, 30));

function parseIssueDate(raw: string | undefined): Date {
  const v = (raw ?? '').trim();
  if (!v) return HISTORICAL_ISSUE_FALLBACK;
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : HISTORICAL_ISSUE_FALLBACK;
}

export async function planOpexBillImport(csvText: string): Promise<{
  ok: true;
  plan: OpexBillImportPlan;
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
      error: `Missing required columns: ${missing.join(', ')}. Required: chargeCode, item, amount.`,
    };
  }

  // Build the universe of project codes referenced.
  const codes = new Set<string>();
  for (const r of parsed.data.rows) {
    const codeRaw = (r['chargecode'] || '').trim().toUpperCase();
    const remapped = CODE_REMAP[codeRaw] ?? codeRaw;
    if (remapped) codes.add(remapped);
  }
  // FHX000 is the fallback bucket.
  codes.add('FHX000');

  const projects = await prisma.project.findMany({
    where: { code: { in: Array.from(codes) } },
    select: { id: true, code: true },
  });
  const projectByCode = new Map(projects.map((p) => [p.code.toUpperCase(), p.id]));
  const fhxId = projectByCode.get('FHX000');
  if (!fhxId) {
    return {
      ok: false,
      error: 'FHX000 catch-all project is missing in the DB — create it before importing OPEX.',
    };
  }

  const rows: OpexBillImportRow[] = [];
  let lineNo = 1;
  let totalAmount = 0;
  for (const r of parsed.data.rows) {
    lineNo += 1;
    const chargeCodeRaw = (r['chargecode'] || '').trim().toUpperCase();
    const chargeCode = CODE_REMAP[chargeCodeRaw] ?? chargeCodeRaw;
    const skip = (note: string): OpexBillImportRow => ({
      lineNo, action: 'skip', chargeCode: chargeCode || '(empty)', note,
    });
    if (!r['item']) {
      rows.push(skip('item empty.'));
      continue;
    }
    const amountRaw = Number((r['amount'] ?? '0').toString().replace(/[,$\s]/g, ''));
    if (!Number.isFinite(amountRaw)) {
      rows.push(skip(`amount "${r['amount']}" unparseable.`));
      continue;
    }
    if (amountRaw === 0) {
      rows.push(skip('amount is zero — nothing to import.'));
      continue;
    }
    const amountTotal = Math.round(amountRaw * 100);

    // Route: known code → that project; unknown / blank → FHX000.
    const projectId = projectByCode.get(chargeCode) ?? fhxId;
    const routed = projectByCode.has(chargeCode) ? chargeCode : 'FHX000';
    const remappedNote = chargeCode !== chargeCodeRaw ? ` (remapped from ${chargeCodeRaw})` : '';
    const routedNote = routed !== chargeCode ? ` (routed to FHX000 — unknown code)` : '';

    const gstRaw = Number((r['gst'] ?? '0').toString().replace(/[,$\s]/g, ''));
    const gst = Number.isFinite(gstRaw) && gstRaw > 0 ? Math.round(gstRaw * 100) : 0;

    const issueDate = parseIssueDate(r['issuedate']);
    const supplierName = (r['supplier'] || r['item'] || 'OPEX import').trim();
    const category = (r['atocategory'] || 'Other').trim();

    rows.push({
      lineNo,
      action: 'create',
      chargeCode: routed,
      note: `${routed}${remappedNote}${routedNote} · ${r['item']} · AUD ${amountRaw.toLocaleString('en-AU')}`,
      data: {
        projectId,
        supplierName,
        category,
        amountTotal,
        gst,
        // Historicals are already paid — set dueDate = issueDate so
        // the AP aging report doesn't flag them as overdue.
        issueDate,
        dueDate: issueDate,
        notes: r['notes']?.trim() || `OPEX import: ${r['item']}`,
        status: 'paid' as BillStatus,
      },
    });
    totalAmount += amountTotal;
  }

  const counts = {
    create: rows.filter((r) => r.action === 'create').length,
    skip: rows.filter((r) => r.action === 'skip').length,
    total: rows.length,
  };
  return {
    ok: true,
    plan: { rows, counts, totals: { amount: totalAmount } },
  };
}
