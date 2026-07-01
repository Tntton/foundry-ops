/**
 * Invoice CSV importer — historical revenue backfill from the FY26
 * master tracker (Project Index tab) or any invoice-level export.
 *
 * Required headers: projectCode, amountExGst
 * Optional headers:
 *   number          — invoice number; auto-generated per project if blank
 *                     ("<projectCode>-INV-HIST-<seq>")
 *   issueDate       — ISO; defaults to project.startDate, else today
 *   dueDate         — ISO; defaults to issueDate + 30d
 *   paymentReceived — cents ex-GST already received; drives status
 *   gst             — cents; defaults to 10% of amountExGst (AU standard)
 *   status          — draft | pending_approval | approved | sent |
 *                     partial | paid | overdue | written_off
 *                     (auto-inferred from paymentReceived when blank)
 *   sentAt          — ISO
 *   paidAt          — ISO
 *   notes           — free text (not stored — for import audit only)
 *
 * Amounts are dollars ex-GST in the CSV; the importer converts to cents.
 * Historical mode: the importer assumes issueDate is in the past and
 * sets status = 'paid' when payment received == invoiced, 'partial'
 * when 0 < received < invoiced, 'sent' when received == 0.
 */
import type { InvoiceStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { parseCsv, requireHeaders } from '@/server/imports/csv-parse';

const REQUIRED_HEADERS = ['projectcode', 'amountexgst'] as const;

const VALID_STATUSES: ReadonlyArray<InvoiceStatus> = [
  'draft', 'pending_approval', 'approved', 'sent', 'partial', 'paid', 'overdue', 'written_off',
];

export type InvoiceImportRow = {
  lineNo: number;
  action: 'create' | 'skip';
  projectCode: string;
  note: string;
  data?: {
    number: string;
    projectId: string;
    clientId: string;
    issueDate: Date;
    dueDate: Date;
    amountExGst: number; // cents
    gst: number; // cents
    amountTotal: number; // cents
    paymentReceivedAmount: number; // cents
    status: InvoiceStatus;
    sentAt: Date | null;
    paidAt: Date | null;
  };
};

export type InvoiceImportPlan = {
  rows: InvoiceImportRow[];
  counts: { create: number; skip: number; total: number };
  totals: { invoiced: number; received: number };
};

function parseIso(raw: string | undefined): Date | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  // DD/MM/YYYY (Australian) — flip to ISO before Date parse
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Infer InvoiceStatus from received-vs-invoiced when the operator
 * didn't specify a status. Historical import defaults — never issues
 * a draft (would look weird for pre-platform invoices).
 */
function inferStatus(receivedCents: number, invoicedCents: number, hasIssueDate: boolean): InvoiceStatus {
  if (!hasIssueDate) return 'draft';
  if (receivedCents <= 0) return 'sent';
  if (receivedCents >= invoicedCents) return 'paid';
  return 'partial';
}

export async function planInvoiceImport(csvText: string): Promise<{
  ok: true;
  plan: InvoiceImportPlan;
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
      error: `Missing required columns: ${missing.join(', ')}. Required: projectCode, amountExGst.`,
    };
  }

  // Resolve every referenced project + its client in one round-trip.
  const codes = new Set<string>();
  for (const r of parsed.data.rows) {
    if (r['projectcode']) codes.add(r['projectcode'].trim().toUpperCase());
  }
  const projects = codes.size === 0
    ? []
    : await prisma.project.findMany({
        where: { code: { in: Array.from(codes) } },
        select: {
          id: true, code: true, clientId: true,
          startDate: true, endDate: true,
        },
      });
  const projectByCode = new Map(projects.map((p) => [p.code.toUpperCase(), p]));

  // Per-project counter so auto-generated numbers land sequentially.
  const seqByCode = new Map<string, number>();
  // Also pre-fetch existing invoice numbers for these projects so we
  // don't collide.
  const existingNumbers = codes.size === 0
    ? new Set<string>()
    : new Set(
        (await prisma.invoice.findMany({
          where: { projectId: { in: projects.map((p) => p.id) } },
          select: { number: true },
        })).map((i) => i.number),
      );

  const rows: InvoiceImportRow[] = [];
  let lineNo = 1;
  let totalInvoiced = 0;
  let totalReceived = 0;
  for (const r of parsed.data.rows) {
    lineNo += 1;
    const projectCode = (r['projectcode'] || '').trim().toUpperCase();
    const skip = (note: string): InvoiceImportRow => ({
      lineNo, action: 'skip', projectCode, note,
    });
    if (!projectCode) { rows.push(skip('projectCode empty.')); continue; }
    const project = projectByCode.get(projectCode);
    if (!project) { rows.push(skip(`No project with code "${projectCode}".`)); continue; }

    const amountRaw = Number((r['amountexgst'] ?? '0').toString().replace(/[,$\s]/g, ''));
    if (!Number.isFinite(amountRaw)) {
      rows.push(skip(`amountExGst "${r['amountexgst']}" unparseable.`));
      continue;
    }
    if (amountRaw === 0) {
      rows.push(skip('amountExGst is zero — nothing to invoice.'));
      continue;
    }
    if (amountRaw < 0) {
      rows.push(skip('amountExGst is negative — refunds not yet supported.'));
      continue;
    }
    const amountExGst = Math.round(amountRaw * 100);

    // GST — default 10% (AU standard) when not provided.
    let gst: number;
    const gstRaw = r['gst']?.toString().replace(/[,$\s]/g, '');
    if (gstRaw && gstRaw.length > 0) {
      const g = Number(gstRaw);
      gst = Number.isFinite(g) && g >= 0 ? Math.round(g * 100) : Math.round(amountExGst * 0.1);
    } else {
      gst = Math.round(amountExGst * 0.1);
    }
    const amountTotal = amountExGst + gst;

    // Payment received — plain number in ex-GST dollars.
    const receivedRaw = Number((r['paymentreceived'] ?? '0').toString().replace(/[,$\s]/g, ''));
    const paymentReceivedAmount = Number.isFinite(receivedRaw) && receivedRaw > 0
      ? Math.round(receivedRaw * 100)
      : 0;

    // Dates — issueDate defaults to project.startDate; dueDate = issue + 30d.
    const issueDate = parseIso(r['issuedate']) ?? project.startDate ?? new Date();
    const dueDate = parseIso(r['duedate']) ?? new Date(issueDate.getTime() + 30 * 86_400_000);

    // Status — explicit override or inferred.
    let status: InvoiceStatus;
    const statusRaw = (r['status'] || '').trim().toLowerCase();
    if (statusRaw && (VALID_STATUSES as ReadonlyArray<string>).includes(statusRaw)) {
      status = statusRaw as InvoiceStatus;
    } else {
      status = inferStatus(paymentReceivedAmount, amountExGst, issueDate !== null);
    }

    // Number — auto-gen if not provided; collide-safe against DB + this CSV.
    let number = (r['number'] || '').trim();
    if (!number) {
      const seq = (seqByCode.get(projectCode) ?? 0) + 1;
      seqByCode.set(projectCode, seq);
      let candidate = `${projectCode}-INV-HIST-${String(seq).padStart(2, '0')}`;
      while (existingNumbers.has(candidate)) {
        const next = (seqByCode.get(projectCode) ?? seq) + 1;
        seqByCode.set(projectCode, next);
        candidate = `${projectCode}-INV-HIST-${String(next).padStart(2, '0')}`;
      }
      number = candidate;
    }
    if (existingNumbers.has(number)) {
      rows.push(skip(`Invoice number "${number}" already exists.`));
      continue;
    }
    existingNumbers.add(number);

    const sentAt = parseIso(r['sentat']);
    const paidAt = parseIso(r['paidat'])
      ?? (status === 'paid' ? issueDate : null);

    rows.push({
      lineNo,
      action: 'create',
      projectCode,
      note: `${number} · AUD ${amountRaw.toLocaleString('en-AU')} · ${status}${
        paymentReceivedAmount > 0
          ? ` · received ${(paymentReceivedAmount / 100).toLocaleString('en-AU')}`
          : ''
      }`,
      data: {
        number,
        projectId: project.id,
        clientId: project.clientId,
        issueDate,
        dueDate,
        amountExGst,
        gst,
        amountTotal,
        paymentReceivedAmount,
        status,
        sentAt,
        paidAt,
      },
    });
    totalInvoiced += amountExGst;
    totalReceived += paymentReceivedAmount;
  }

  const counts = {
    create: rows.filter((r) => r.action === 'create').length,
    skip: rows.filter((r) => r.action === 'skip').length,
    total: rows.length,
  };
  return {
    ok: true,
    plan: { rows, counts, totals: { invoiced: totalInvoiced, received: totalReceived } },
  };
}
