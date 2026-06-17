/**
 * Uber for Business CSV import — parses the "Trip activity" report
 * export (Uber for Business admin → Reports → Trip activity →
 * Download CSV). Each row becomes a Foundry Bill row.
 *
 * Same shape as the Navan CSV importer:
 *   - `supplierName` = "Uber"
 *   - `receivedVia` = 'uber_csv'
 *   - `attributedToPersonId` = the rider (matched by email)
 *   - `category` = 'travel'
 *   - `projectId` auto-tagged when the row's Expense Code OR Memo
 *     carries a Foundry project code (e.g. `MQH001`).
 *
 * Idempotency: each Bill's `supplierInvoiceNumber` is set to
 * `uber:trip:<Trip ID>`. Re-uploading the same report skips already-
 * imported trips.
 *
 * Canceled / Rider canceled rows are dropped automatically — they
 * still appear in the CSV but shouldn't land as Bills.
 */
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { resolveRequiredRole } from '@/server/approval-policies';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import { resolveTravellerByEmail } from '@/server/integrations/navan-sync';

export type UberCsvImportResult = {
  ok: true;
  imported: number;
  skipped: number;
  canceled: number;
  unmatched: string[];
  projectAutoTagged: number;
};

/** Minimal CSV parser — handles quoted fields with embedded commas
 *  and the doubled-quote escape. Same as the Navan importer. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cur.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function parseMoneyDollars(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^[A-Z]{0,3}\$?\s*/u, '').replace(/,/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractProjectCode(...sources: (string | undefined)[]): string | null {
  for (const s of sources) {
    if (!s) continue;
    const m = s.match(/\b([A-Z]{2,4}\d{3,4})\b/);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Try a list of candidate column names — Uber's exports have shifted
 * header copy over time (e.g. `Trip ID` vs `Request ID`, `Total` vs
 * `Trip Charge`). Returns the first index whose header matches.
 */
function findCol(header: string[], ...candidates: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function importUberCsv(opts: {
  csv: string;
  actorPersonId: string;
}): Promise<UberCsvImportResult> {
  const rows = parseCsv(opts.csv);
  if (rows.length === 0) {
    return {
      ok: true,
      imported: 0,
      skipped: 0,
      canceled: 0,
      unmatched: [],
      projectAutoTagged: 0,
    };
  }
  const header = rows[0]!.map((h) => h.trim());
  // Defensive column-name resolution — Uber's export header copy has
  // varied historically. Each `findCol` call lists the variants seen.
  const cTripId = findCol(header, 'Trip ID', 'Request ID', 'Trip Id');
  const cEmail = findCol(
    header,
    'Employee Email',
    'Rider Email',
    'Email',
    'Employee email',
  );
  const cStatus = findCol(header, 'Trip / Order Status', 'Status', 'Trip Status');
  const cDate = findCol(
    header,
    'Date Completed',
    'Date Booked',
    'Request Date',
    'Trip Date',
  );
  const cTotal = findCol(header, 'Total', 'Trip Charge', 'Fare Total');
  const cTax = findCol(header, 'Tax', 'Tax Total', 'GST');
  const cExpenseCode = findCol(header, 'Expense Code', 'Cost Center', 'Project Code');
  const cMemo = findCol(header, 'Notes', 'Note', 'Memo', 'Expense Memo');
  const cPickup = findCol(header, 'Pickup Address', 'Pickup');
  const cDropoff = findCol(header, 'Dropoff Address', 'Dropoff', 'Destination');
  const cInvoiceUrl = findCol(header, 'Invoice', 'Invoice URL', 'Receipt URL');

  if (cTripId < 0 || cEmail < 0 || cTotal < 0) {
    throw new Error(
      `CSV header missing required columns (got: ${header.slice(0, 8).join(', ')}…). Make sure you exported "Trip activity" from Uber for Business.`,
    );
  }

  let imported = 0;
  let skipped = 0;
  let canceled = 0;
  let projectAutoTagged = 0;
  const unmatched = new Set<string>();

  // Pre-resolve project codes mentioned in the CSV so we batch the
  // project lookup. Code can appear in either the Expense Code OR
  // the Memo column.
  const candidateCodes = new Set<string>();
  for (let i = 1; i < rows.length; i += 1) {
    const code = extractProjectCode(
      rows[i]?.[cExpenseCode],
      rows[i]?.[cMemo],
    );
    if (code) candidateCodes.add(code);
  }
  const projectByCode = new Map<string, string>();
  if (candidateCodes.size > 0) {
    const found = await prisma.project.findMany({
      where: { code: { in: [...candidateCodes] } },
      select: { id: true, code: true },
    });
    for (const p of found) projectByCode.set(p.code, p.id);
  }

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const status = (row[cStatus] ?? '').trim().toLowerCase();
    if (
      status === 'canceled' ||
      status === 'cancelled' ||
      status === 'rider canceled' ||
      status === 'rider cancelled' ||
      status === 'driver canceled' ||
      status === 'driver cancelled'
    ) {
      canceled += 1;
      continue;
    }

    const tripId = row[cTripId]?.trim();
    if (!tripId) continue;
    const uberRef = `uber:trip:${tripId}`;
    const dup = await prisma.bill.findFirst({
      where: { supplierInvoiceNumber: { startsWith: uberRef } },
      select: { id: true },
    });
    if (dup) {
      skipped += 1;
      continue;
    }

    const email = (row[cEmail] ?? '').trim().toLowerCase();
    if (!email) {
      unmatched.add('(no email)');
      continue;
    }
    const rider = await resolveTravellerByEmail(email);
    if (!rider) {
      unmatched.add(email);
      continue;
    }

    const amountDollars = parseMoneyDollars(row[cTotal]);
    if (amountDollars === null || amountDollars <= 0) continue;
    const amountCents = Math.round(amountDollars * 100);
    const gstCents = Math.round((parseMoneyDollars(row[cTax]) ?? 0) * 100);

    const dateRaw = row[cDate]?.trim();
    const date = dateRaw ? new Date(dateRaw) : new Date();
    const issueDate = Number.isNaN(date.getTime()) ? new Date() : date;

    const projectCode = extractProjectCode(row[cExpenseCode], row[cMemo]);
    const projectId = projectCode
      ? projectByCode.get(projectCode) ?? null
      : null;
    if (projectId) projectAutoTagged += 1;

    const pickup = row[cPickup]?.trim();
    const dropoff = row[cDropoff]?.trim();
    const tripSummary = [pickup, dropoff].filter(Boolean).join(' → ');
    const invoiceUrl = row[cInvoiceUrl]?.trim() || null;

    const requiredRole = await resolveRequiredRole('bill', amountCents);

    await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          supplierName: 'Uber',
          supplierInvoiceNumber: uberRef,
          receivedVia: 'uber_csv',
          attachmentSharepointUrl: invoiceUrl,
          issueDate,
          dueDate: issueDate, // firm-paid; no aging
          amountTotal: amountCents,
          gst: gstCents,
          category: 'travel',
          projectId,
          attributedToPersonId: rider.id,
          status: 'pending_review',
        },
      });
      const approval = await tx.approval.create({
        data: {
          subjectType: 'bill',
          subjectId: bill.id,
          requestedById: opts.actorPersonId,
          requiredRole,
          thresholdContext: {
            amount_cents: amountCents,
            source: 'uber_csv',
            uber_trip_id: tripId,
            rider_person_id: rider.id,
            ...(tripSummary ? { route: tripSummary } : {}),
            ...(projectCode ? { project_code: projectCode } : {}),
          },
          channel: 'web',
        },
        select: { id: true },
      });
      await notifyApproversOfNewApproval(tx, {
        approvalId: approval.id,
        subjectType: 'bill',
        subjectId: bill.id,
        requiredRole,
        requestedById: opts.actorPersonId,
        amountCents,
        summary: `Uber · $${(amountCents / 100).toFixed(0)}${tripSummary ? ` · ${tripSummary}` : ''}`,
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: opts.actorPersonId },
        action: 'created',
        entity: {
          type: 'bill',
          id: bill.id,
          after: {
            via: 'uber_csv',
            uber_trip_id: tripId,
            amount: amountCents,
            rider_person_id: rider.id,
            firm_paid_via: 'amex',
            ...(tripSummary ? { route: tripSummary } : {}),
            ...(projectCode ? { project_code: projectCode, project_id: projectId } : {}),
          },
        },
        source: 'integration_sync',
      });
    });
    imported += 1;
  }

  return {
    ok: true,
    imported,
    skipped,
    canceled,
    unmatched: [...unmatched],
    projectAutoTagged,
  };
}
