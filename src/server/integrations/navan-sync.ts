'use server';

import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { resolveRequiredRole } from '@/server/approval-policies';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import {
  fetchBookingsSinceLastSync,
  fetchExpensesSinceLastSync,
  markSynced,
  mapNavanExpenseCategory,
  type NavanBooking,
  type NavanExpense,
} from '@/server/integrations/navan';

/**
 * Navan → Foundry sync pass.
 *
 * Pulls every booking + expense Navan has updated since our last
 * watermark and lands them as Foundry Expense rows in `submitted`
 * status — same shape the receipt-upload flow produces, so the
 * approval queue + Xero push handle them with no special-casing.
 *
 * Idempotency: Navan's id is stamped onto the Expense's
 * `description` (prefixed with `navan:<id>`) so a re-run of the same
 * window is a no-op (we skip rows whose description already starts
 * with that prefix).
 *
 * Failures: an unmatched traveller email (no Person row with that
 * email) is skipped + reported in the result. The sync as a whole
 * keeps going so one bad row doesn't poison the batch.
 */

export type NavanSyncResult = {
  ok: true;
  imported: number;
  skipped: number;
  unmatched: string[];
  /** Most recent updatedAt across each kind, used to bump the
   *  watermark on success. */
  bookingsAt: string | null;
  expensesAt: string | null;
};

export async function runNavanSync(opts?: {
  /** When set, the sync writes audit / approval rows attributed to
   *  this person. Falls back to the system actor (no person id) when
   *  triggered by a cron / webhook. */
  triggeredBy?: { id: string };
}): Promise<NavanSyncResult> {
  const [bookings, expenses] = await Promise.all([
    fetchBookingsSinceLastSync(),
    fetchExpensesSinceLastSync(),
  ]);

  let imported = 0;
  let skipped = 0;
  const unmatched = new Set<string>();
  let bookingsAt: string | null = null;
  let expensesAt: string | null = null;

  for (const b of bookings) {
    const result = await landBooking(b, opts?.triggeredBy?.id);
    if (result === 'imported') imported += 1;
    else if (result === 'skipped') skipped += 1;
    else if (result === 'unmatched') unmatched.add(extractEmail(b) ?? '(no email)');
    const ts = extractUpdatedAt(b);
    if (ts && (!bookingsAt || ts > bookingsAt)) bookingsAt = ts;
  }
  for (const e of expenses) {
    const result = await landExpense(e, opts?.triggeredBy?.id);
    if (result === 'imported') imported += 1;
    else if (result === 'skipped') skipped += 1;
    else if (result === 'unmatched') unmatched.add(extractEmail(e) ?? '(no email)');
    const ts = extractUpdatedAt(e);
    if (ts && (!expensesAt || ts > expensesAt)) expensesAt = ts;
  }

  await markSynced({
    ...(bookingsAt ? { bookingsAt } : {}),
    ...(expensesAt ? { expensesAt } : {}),
  });

  return {
    ok: true,
    imported,
    skipped,
    unmatched: [...unmatched],
    bookingsAt,
    expensesAt,
  };
}

type LandResult = 'imported' | 'skipped' | 'unmatched';

/**
 * Resolve a Navan-supplied traveller email to a Foundry Person.
 *
 * Navan + Foundry both use `firstname.lastname@foundry.health` for the
 * vast majority of staff, so the literal lookup hits directly. The
 * exception is the three full partners (Trung / Michael / Chris), who
 * use first-name-only addresses (`trung@`, `michael@`, `chris@`) on the
 * Foundry side — Navan will send the full-form (`trung.ton@`) for them.
 * The pre-dot fallback below handles that case: if the literal misses
 * and the local-part contains a dot, we also try the pre-dot fragment
 * on the same domain.
 *
 * Exported so the CSV importer (and any future Navan-shaped feed) can
 * share the same resolution path.
 */
export async function resolveTravellerByEmail(email: string): Promise<{
  id: string;
} | null> {
  const lower = email.trim().toLowerCase();
  if (!lower) return null;
  const direct = await prisma.person.findUnique({
    where: { email: lower },
    select: { id: true },
  });
  if (direct) return direct;
  // Partner-only fallback: strip everything between the first dot and
  // the @ (so `trung.ton@foundry.health` → `trung@foundry.health`).
  // Only the three full partners use a short alias on the Foundry side;
  // everyone else's literal lookup above already hit. Skip when the
  // email doesn't fit the pattern (no dot in local part, no @) to
  // avoid surprising matches on legitimate emails.
  const at = lower.indexOf('@');
  if (at <= 0) return null;
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  const dot = local.indexOf('.');
  if (dot <= 0) return null;
  const aliased = `${local.slice(0, dot)}@${domain}`;
  return prisma.person.findUnique({
    where: { email: aliased },
    select: { id: true },
  });
}

/**
 * Defensive field extractors — Navan's BDI response shape isn't
 * documented exhaustively, so each Foundry-side field accepts several
 * candidate keys (camelCase, snake_case, nested traveller/user
 * object). When none of the candidates resolve, we return null and
 * the caller skips the row with an "unmatched" outcome (logged), so
 * one malformed booking can't crash the whole sync.
 */
function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function extractEmail(row: unknown): string | null {
  // Top-level candidates first, then nested traveller/user/passenger
  // objects that some Navan payloads wrap things in.
  const top = pick(
    row,
    'travellerEmail',
    'travelerEmail',
    'traveler_email',
    'traveller_email',
    'userEmail',
    'user_email',
    'email',
  );
  if (typeof top === 'string') return top;
  for (const nest of ['traveler', 'traveller', 'user', 'passenger', 'guest']) {
    const v = pick(pick(row, nest), 'email', 'emailAddress', 'email_address');
    if (typeof v === 'string') return v;
  }
  // Navan bookings: `passengers` is an array of { person: { email } }.
  // Prefer the first passenger's person email (the actual traveller).
  const passengers = pick(row, 'passengers');
  if (Array.isArray(passengers)) {
    for (const p of passengers) {
      const personEmail = pick(pick(p, 'person'), 'email', 'emailAddress', 'email_address');
      if (typeof personEmail === 'string') return personEmail;
      const direct = pick(p, 'email', 'emailAddress', 'email_address');
      if (typeof direct === 'string') return direct;
    }
  }
  // Fallback to booker.email — the person who created the booking
  // (often but not always the traveller).
  const bookerEmail = pick(pick(row, 'booker'), 'email', 'emailAddress', 'email_address');
  if (typeof bookerEmail === 'string') return bookerEmail;
  return null;
}

function extractAmountDollars(row: unknown): number | null {
  const v = pick(
    row,
    'totalAmount',
    'total_amount',
    'amount',
    'grossAmount',
    'gross_amount',
    'priceTotal',
    'price_total',
  );
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && !isNaN(Number(v))) return Number(v);
  return null;
}

function extractUpdatedAt(row: unknown): string | null {
  const v = pick(
    row,
    'updatedAt',
    'updated_at',
    'modifiedAt',
    'modified_at',
    'lastModified',
    'last_modified',
    'createdAt',
    'created_at',
  );
  return typeof v === 'string' ? v : null;
}

function extractDate(row: unknown, ...keys: string[]): Date | null {
  const v = pick(row, ...keys);
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof v === 'number') {
    // Treat numbers as unix epoch seconds (Navan BDI convention).
    return new Date(v * 1000);
  }
  return null;
}

function extractString(row: unknown, ...keys: string[]): string | null {
  const v = pick(row, ...keys);
  return typeof v === 'string' ? v : null;
}

function extractId(row: unknown): string | null {
  const v = pick(row, 'id', 'bookingId', 'booking_id', 'uuid', 'reference');
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

/**
 * Land a Navan booking as a firm-paid **Bill** (not an Expense). The
 * AMEX has already paid Navan; we record this on the AP side with the
 * traveller in `attributedToPersonId` so utilisation rolls up the
 * cost under their name without anyone reading it as a reimbursable.
 *
 * Mirrors the CSV importer's shape so re-imports between the two
 * paths are idempotent against the same `navan:booking:<id>` prefix
 * on `supplierInvoiceNumber`.
 */
async function landBooking(
  b: NavanBooking,
  actorPersonId: string | undefined,
): Promise<LandResult> {
  const email = extractEmail(b);
  if (!email) return 'unmatched';
  const traveller = await resolveTravellerByEmail(email);
  if (!traveller) return 'unmatched';

  const bookingId = extractId(b);
  if (!bookingId) {
    console.warn('[navan.sync] booking without resolvable id, skipping');
    return 'unmatched';
  }
  const navanRef = `navan:booking:${bookingId}`;
  const dup = await prisma.bill.findFirst({
    where: { supplierInvoiceNumber: { startsWith: navanRef } },
    select: { id: true },
  });
  if (dup) return 'skipped';

  const amountDollars = extractAmountDollars(b);
  if (amountDollars === null) {
    console.warn(
      `[navan.sync] booking ${bookingId} has no resolvable amount, skipping`,
    );
    return 'unmatched';
  }
  const amountCents = Math.round(amountDollars * 100);
  const taxDollars =
    extractAmountDollars(
      // Tax / gst column candidates — Navan sometimes returns it as a
      // top-level number, sometimes nested under priceBreakdown.
      typeof b === 'object' && b !== null
        ? (b as Record<string, unknown>)['tax'] ??
            (b as Record<string, unknown>)['taxAmount'] ??
            (b as Record<string, unknown>)['gst']
        : undefined,
    ) ?? 0;
  const gstCents = Math.round(taxDollars * 100);
  const startDate =
    extractDate(b, 'startDate', 'start_date', 'departureDate', 'departure_date') ??
    new Date();
  const bookingType =
    extractString(b, 'type', 'bookingType', 'booking_type') ?? 'booking';
  const vendor =
    extractString(b, 'vendor', 'supplier', 'merchant', 'airline', 'hotel') ??
    'Navan booking';
  const desc = extractString(b, 'description', 'name', 'title') ?? '';
  const description = `${bookingType} · ${desc}`.slice(0, 1000);
  const invoiceRef =
    extractString(b, 'invoiceNumber', 'invoice_number', 'reference') ??
    null;
  const supplierInvoiceNumber = invoiceRef
    ? `${navanRef}:${invoiceRef}`
    : navanRef;
  const requiredRole = await resolveRequiredRole('bill', amountCents);
  const actor = actorPersonId ?? traveller.id;

  await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.create({
      data: {
        supplierName: vendor,
        supplierInvoiceNumber,
        receivedVia: 'navan_api',
        issueDate: startDate,
        // Firm already paid via AMEX — no real due date, set =
        // issueDate so AP-aging charts don't flag these as "overdue".
        dueDate: startDate,
        amountTotal: amountCents,
        gst: gstCents,
        category: 'travel',
        projectId: null,
        attributedToPersonId: traveller.id,
        status: 'pending_review',
      },
    });
    const approval = await tx.approval.create({
      data: {
        subjectType: 'bill',
        subjectId: bill.id,
        requestedById: actor,
        requiredRole,
        thresholdContext: {
          amount_cents: amountCents,
          source: 'navan_api',
          navan_id: bookingId,
          traveller_person_id: traveller.id,
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
      requestedById: actor,
      summary: `${vendor} · $${(amountCents / 100).toFixed(0)} · Navan ${bookingType}`,
    });
    await writeAudit(tx, {
      actor: actorPersonId
        ? { type: 'person', id: actorPersonId }
        : { type: 'system' },
      action: 'created',
      entity: {
        type: 'bill',
        id: bill.id,
        after: {
          via: 'navan_sync',
          source: 'booking',
          navan_id: bookingId,
          amount: amountCents,
          traveller_person_id: traveller.id,
          firm_paid_via: 'amex',
        },
      },
      source: 'integration_sync',
    });
  });
  // Description (which goes into the bill notes / used by the
  // intake review pane) — appended after create via update so the
  // tx above stays focused on the audit-critical fields. Bills
  // schema doesn't have a description field today; the trip details
  // live in `supplierInvoiceNumber` (booking id) + the audit row
  // delta. If we want richer copy on bills, that's a small schema
  // addition.
  void description;
  return 'imported';
}

async function landExpense(
  e: NavanExpense,
  actorPersonId: string | undefined,
): Promise<LandResult> {
  const email = extractEmail(e);
  if (!email) return 'unmatched';
  const person = await resolveTravellerByEmail(email);
  if (!person) return 'unmatched';
  const expenseId =
    extractString(e, 'id', 'expenseId', 'expense_id', 'uuid') ?? null;
  if (!expenseId) return 'unmatched';
  const navanRef = `navan:expense:${expenseId}`;
  const dup = await prisma.expense.findFirst({
    where: { description: { startsWith: navanRef } },
    select: { id: true },
  });
  if (dup) return 'skipped';

  const amountDollars = extractAmountDollars(e);
  if (amountDollars === null) return 'unmatched';
  const amountCents = Math.round(amountDollars * 100);
  const gstRaw = pick(e, 'gstAmount', 'gst_amount', 'gst', 'taxAmount', 'tax_amount');
  const gstCents =
    typeof gstRaw === 'number'
      ? Math.round(gstRaw * 100)
      : typeof gstRaw === 'string' && !isNaN(Number(gstRaw))
        ? Math.round(Number(gstRaw) * 100)
        : 0;
  const merchant =
    extractString(e, 'merchant', 'vendor', 'supplier') ?? 'Navan expense';
  const notes = extractString(e, 'notes', 'description', 'memo');
  const description = [navanRef, merchant, notes].filter(Boolean).join(' · ').slice(0, 1000);
  const requiredRole = await resolveRequiredRole('expense', amountCents);
  const rawCategory = extractString(e, 'category', 'merchantCategory', 'merchant_category') ?? '';
  const category = mapNavanExpenseCategory(rawCategory);
  const expenseDate = extractDate(e, 'date', 'transactionDate', 'transaction_date') ?? new Date();
  const receiptUrl = extractString(e, 'receiptUrl', 'receipt_url', 'invoiceUrl', 'invoice_url');

  await prisma.$transaction(async (tx) => {
    const row = await tx.expense.create({
      data: {
        personId: person.id,
        projectId: null,
        date: expenseDate,
        amount: amountCents,
        gst: gstCents,
        category,
        vendor: merchant,
        description,
        receiptSharepointUrl: receiptUrl,
        status: 'submitted',
      },
    });
    const approval = await tx.approval.create({
      data: {
        subjectType: 'expense',
        subjectId: row.id,
        requestedById: person.id,
        requiredRole,
        thresholdContext: {
          amount_cents: amountCents,
          threshold_cents: 200_000,
          source: 'navan_expense',
          navan_id: expenseId,
        },
        channel: 'web',
      },
      select: { id: true },
    });
    await notifyApproversOfNewApproval(tx, {
      approvalId: approval.id,
      subjectType: 'expense',
      subjectId: row.id,
      requiredRole,
      requestedById: person.id,
      summary: `${merchant} · $${(amountCents / 100).toFixed(0)} · Navan`,
    });
    await writeAudit(tx, {
      actor: actorPersonId
        ? { type: 'person', id: actorPersonId }
        : { type: 'system' },
      action: 'created',
      entity: {
        type: 'expense',
        id: row.id,
        after: {
          via: 'navan_sync',
          source: 'expense',
          navan_id: expenseId,
          amount: amountCents,
        },
      },
      source: 'integration_sync',
    });
  });
  return 'imported';
}
