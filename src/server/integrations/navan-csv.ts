/**
 * Navan CSV import — parses the manual "Bookings" report export
 * (Navan admin → Reports → Bookings → Download CSV) into Foundry
 * **Bill** rows (not Expense rows).
 *
 * The shift to Bill is deliberate: Navan bookings are paid by Foundry
 * via the corporate AMEX directly on Navan's platform — there's
 * nothing to reimburse the traveller. The right home in Foundry's
 * model is therefore Bill (firm-paid AP) with:
 *   - `supplierName` = the airline / hotel / rail vendor
 *   - `attributedToPersonId` = the traveller, so utilisation reports
 *     can roll travel costs up under the person who flew, without
 *     anyone thinking it's a reimbursable.
 *   - `projectId` auto-tagged when the Navan trip name carries a
 *     Foundry project code (e.g. "MQH001 Feb 2026").
 *
 * Idempotency: each Bill's `supplierInvoiceNumber` is set to the
 * Navan Booking ID prefixed `navan:booking:<id>`. Re-uploading the
 * same report skips already-imported bookings via that prefix check.
 *
 * Voided rows are dropped automatically — Navan exports voided
 * bookings alongside the live ticket row for the same trip.
 */
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { resolveRequiredRole } from '@/server/approval-policies';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import { resolveTravellerByEmail } from '@/server/integrations/navan-sync';

export type NavanCsvImportResult = {
  ok: true;
  imported: number;
  skipped: number;
  voided: number;
  unmatched: string[];
  /** Trip-name → resolved-projectId hits (for telemetry / debug). */
  projectAutoTagged: number;
};

/**
 * Minimal CSV parser — handles quoted fields with embedded commas and
 * the doubled-quote escape (`""` inside a quoted field = single `"`).
 * Sufficient for Navan's bookings report; not a general-purpose CSV
 * library and intentionally so (no external dep).
 */
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
  // Filter trailing empty rows.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function parseMoneyDollars(raw: string | undefined): number | null {
  if (!raw) return null;
  // Strip leading currency tokens like `A$`, `$`, `AUD `, `EUR ` etc.
  const cleaned = raw.replace(/^[A-Z]{0,3}\$?\s*/u, '').replace(/,/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Heuristic project-code match. Navan trip names often start with the
 * Foundry project code (e.g. `MQH001 Feb 2026`, `GNC001 - TT`).
 * Picks the first token matching `^[A-Z]{2,4}\d{3,4}$`.
 */
function extractProjectCode(tripName: string | undefined): string | null {
  if (!tripName) return null;
  const match = tripName.match(/\b([A-Z]{2,4}\d{3,4})\b/);
  return match?.[1] ?? null;
}

export async function importNavanCsv(opts: {
  csv: string;
  actorPersonId: string;
}): Promise<NavanCsvImportResult> {
  const rows = parseCsv(opts.csv);
  if (rows.length === 0) {
    return { ok: true, imported: 0, skipped: 0, voided: 0, unmatched: [], projectAutoTagged: 0 };
  }
  const header = rows[0]!.map((h) => h.trim());
  const idx = (name: string): number => header.indexOf(name);
  // Resolve column positions once.
  const cBookingId = idx('Booking ID');
  const cEmail = idx('Traveling User Email');
  const cFallbackEmail = idx('Booking User Email');
  const cTotal = idx('Total Paid');
  const cTax = idx('Tax');
  const cType = idx('Type');
  const cVendor = idx('Vendor');
  const cStatus = idx('Booking Status');
  const cStartDate = idx('Booking Start Date');
  const cTripName = idx('Trip name');
  const cDescription = idx('Description');
  const cInvoiceNumber = idx('Invoice Number');

  if (cBookingId < 0 || cEmail < 0 || cTotal < 0 || cType < 0) {
    throw new Error(
      `CSV header missing required columns (got: ${header.slice(0, 8).join(', ')}…). Make sure you exported "Bookings" from Navan Reports.`,
    );
  }

  let imported = 0;
  let skipped = 0;
  let voided = 0;
  let projectAutoTagged = 0;
  const unmatched = new Set<string>();

  // Pre-resolve project codes mentioned in the CSV so we can join
  // them to project rows in one query — cheaper than one lookup per row.
  const candidateCodes = new Set<string>();
  for (let i = 1; i < rows.length; i += 1) {
    const code = extractProjectCode(rows[i]?.[cTripName]);
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
    const status = row[cStatus]?.trim();
    if (status === 'VOIDED') {
      voided += 1;
      continue;
    }

    const bookingId = row[cBookingId]?.trim();
    if (!bookingId) {
      continue; // skip rows without a key
    }
    // Skip if already imported (idempotency via supplierInvoiceNumber
    // prefix on Bill rows).
    const navanRef = `navan:booking:${bookingId}`;
    const dup = await prisma.bill.findFirst({
      where: { supplierInvoiceNumber: { startsWith: navanRef } },
      select: { id: true },
    });
    if (dup) {
      skipped += 1;
      continue;
    }

    const email = (row[cEmail] || row[cFallbackEmail] || '').trim().toLowerCase();
    if (!email) {
      unmatched.add('(no email)');
      continue;
    }
    // resolveTravellerByEmail tries the literal email first, then the
    // short-alias fallback (julia.maguire@ → julia@) for the
    // Foundry-team email convention mismatch with Navan's
    // firstname.lastname@ format.
    const traveller = await resolveTravellerByEmail(email);
    if (!traveller) {
      unmatched.add(email);
      continue;
    }

    const amountDollars = parseMoneyDollars(row[cTotal]);
    if (amountDollars === null || amountDollars <= 0) {
      continue;
    }
    const amountCents = Math.round(amountDollars * 100);
    const gstCents = Math.round((parseMoneyDollars(row[cTax]) ?? 0) * 100);

    const bookingType = (row[cType] || 'booking').trim().toLowerCase();
    const vendor = (row[cVendor] || 'Navan booking').trim();
    const tripName = row[cTripName]?.trim() || null;
    const startDateRaw = row[cStartDate]?.trim();
    const startDate = startDateRaw ? new Date(startDateRaw) : new Date();
    const issueDate = Number.isNaN(startDate.getTime()) ? new Date() : startDate;

    const projectCode = extractProjectCode(tripName ?? undefined);
    const projectId = projectCode ? projectByCode.get(projectCode) ?? null : null;
    if (projectId) projectAutoTagged += 1;

    const invoiceNum = row[cInvoiceNumber]?.trim();
    // supplierInvoiceNumber doubles as the dedupe key + the
    // canonical reference back to Navan's record. Format:
    // "navan:booking:<id>:U-1234567" so admins can grep / search.
    const supplierInvoiceNumber = invoiceNum
      ? `${navanRef}:${invoiceNum}`
      : navanRef;
    // Description retained for the audit-event delta below — Bills
    // table has no dedicated description column today; trip details
    // live in `supplierInvoiceNumber` (booking id) + the audit row.
    // If we add a Bill.description column later, drop this into it.
    const description = [
      `${bookingType} · ${vendor}`,
      tripName ? `trip "${tripName}"` : null,
      row[cDescription]?.trim() || null,
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 1000);

    const requiredRole = await resolveRequiredRole('bill', amountCents);

    await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.create({
        data: {
          supplierName: vendor,
          supplierInvoiceNumber,
          receivedVia: 'navan_csv',
          attachmentSharepointUrl: null,
          issueDate,
          // Navan-paid bills are already paid via AMEX — set dueDate
          // = issueDate so they don't show up as 'overdue' in any
          // AP-aging chart that's looking at the gap.
          dueDate: issueDate,
          amountTotal: amountCents,
          gst: gstCents,
          category: 'travel',
          projectId,
          // The traveller — for utilisation / cost-by-person
          // reporting. Crucially NOT the reimbursement target.
          attributedToPersonId: traveller.id,
          // Sits in the pre-approval state so admin reviews + locks
          // in the project allocation. (Once an "already paid"
          // status lands in the schema we can flip these straight to
          // it; for now pending_review is the right gate.)
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
            source: 'navan_csv',
            navan_id: bookingId,
            trip_name: tripName,
            traveller_person_id: traveller.id,
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
        summary: `${vendor} · $${(amountCents / 100).toFixed(0)} · Navan ${bookingType}${tripName ? ` (${tripName})` : ''}`,
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: opts.actorPersonId },
        action: 'created',
        entity: {
          type: 'bill',
          id: bill.id,
          after: {
            via: 'navan_csv',
            source: 'booking',
            navan_id: bookingId,
            amount: amountCents,
            description,
            trip_name: tripName,
            traveller_person_id: traveller.id,
            firm_paid_via: 'amex',
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
    voided,
    unmatched: [...unmatched],
    projectAutoTagged,
  };
}
