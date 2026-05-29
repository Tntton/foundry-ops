'use server';

import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { resolveRequiredRole } from '@/server/approval-policies';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import { resolveTravellerByEmail } from '@/server/integrations/navan-sync';
import {
  fetchTripsSinceLastSync,
  markSynced,
  type UberTrip,
} from '@/server/integrations/uber';

/**
 * Uber → Foundry sync pass.
 *
 * Pulls every Uber for Business trip since our last watermark and
 * lands them as Foundry **Bill** rows (firm-paid AP), with the
 * rider in `attributedToPersonId` for utilisation reporting. Same
 * pattern as Navan; the rider email matcher (`resolveTravellerByEmail`)
 * is reused so the literal `julia.maguire@foundry.health` (the canonical
 * convention on both sides) hits directly. For the three full partners
 * who use a first-name-only short alias on the Foundry side, the matcher
 * falls back to `trung.ton@` → `trung@` before giving up.
 *
 * Idempotency: each Bill's `supplierInvoiceNumber` is set to
 * `uber:trip:<trip_id>` so a re-run is a no-op.
 *
 * Status handling: only `completed` trips land as Bills. Canceled /
 * rider-canceled / in-progress rows are skipped (with a return code)
 * so admin doesn't get a Bill for a $0 cancellation.
 */

export type UberSyncResult = {
  ok: true;
  imported: number;
  skipped: number;
  unmatched: string[];
  /** Most recent request_time we saw — used to bump the watermark. */
  tripsAt: string | null;
};

export async function runUberSync(opts?: {
  triggeredBy?: { id: string };
}): Promise<UberSyncResult> {
  const trips = await fetchTripsSinceLastSync();

  let imported = 0;
  let skipped = 0;
  const unmatched = new Set<string>();
  let tripsAt: string | null = null;

  for (const t of trips) {
    const result = await landTrip(t, opts?.triggeredBy?.id);
    if (result === 'imported') imported += 1;
    else if (result === 'skipped') skipped += 1;
    else if (result === 'unmatched') unmatched.add(extractEmail(t) ?? '(no email)');
    const ts = extractUpdatedAt(t);
    if (ts && (!tripsAt || ts > tripsAt)) tripsAt = ts;
  }

  await markSynced({ ...(tripsAt ? { tripsAt } : {}) });

  return { ok: true, imported, skipped, unmatched: [...unmatched], tripsAt };
}

type LandResult = 'imported' | 'skipped' | 'unmatched';

function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function extractEmail(t: UberTrip): string | null {
  // Top-level candidates first, then nested employee/rider objects.
  const top = pick(t, 'email', 'rider_email', 'employee_email');
  if (typeof top === 'string') return top;
  for (const nest of ['employee', 'rider', 'user']) {
    const v = pick(pick(t, nest), 'email', 'email_address');
    if (typeof v === 'string') return v;
  }
  return null;
}

function extractAmountDollars(t: UberTrip): number | null {
  const top = pick(
    t,
    'total_charged',
    'fare_total',
    'total_fare',
    'fare_amount',
    'amount',
  );
  if (typeof top === 'number') return top;
  if (typeof top === 'string' && !isNaN(Number(top))) return Number(top);
  const fare = pick(t, 'fare');
  if (fare && typeof fare === 'object') {
    const v = pick(fare, 'value', 'total', 'amount');
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && !isNaN(Number(v))) return Number(v);
  }
  return null;
}

function extractUpdatedAt(t: UberTrip): string | null {
  const v = pick(
    t,
    'request_time',
    'dropoff_time',
    'begin_trip_time',
    'created_at',
    'updated_at',
  );
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return new Date(v * 1000).toISOString();
  return null;
}

function extractStartDate(t: UberTrip): Date {
  const v = pick(t, 'request_time', 'begin_trip_time', 'dropoff_time');
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof v === 'number') return new Date(v * 1000);
  return new Date();
}

function extractStatus(t: UberTrip): string {
  const v = pick(t, 'status', 'trip_status', 'state');
  return typeof v === 'string' ? v.toLowerCase() : 'unknown';
}

/**
 * Heuristic project-code match — same regex as the Navan CSV
 * importer. Uber's `expense_code` field (when the rider sets it at
 * booking time) usually IS the project code directly; the
 * `expense_memo` (a free-form note) is a secondary fallback.
 */
function extractProjectCode(t: UberTrip): string | null {
  const candidates = [
    pick(t, 'expense_code'),
    pick(t, 'expense_memo'),
    pick(t, 'notes'),
    pick(t, 'note'),
  ];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const m = c.match(/\b([A-Z]{2,4}\d{3,4})\b/);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Land an Uber trip as a firm-paid Bill. AMEX has already settled
 * with Uber; the Bill is the AP-side record + cost attribution to
 * the rider, NOT a reimbursable.
 */
async function landTrip(
  t: UberTrip,
  actorPersonId: string | undefined,
): Promise<LandResult> {
  // Skip non-completed trips — canceled / in_progress shouldn't
  // create Bills.
  const status = extractStatus(t);
  if (status && status !== 'completed') {
    return 'skipped';
  }

  const tripId = t.trip_id ?? (pick(t, 'uuid', 'id') as string | undefined);
  if (!tripId) {
    console.warn('[uber.sync] trip without resolvable id, skipping');
    return 'unmatched';
  }
  const uberRef = `uber:trip:${tripId}`;

  const email = extractEmail(t);
  if (!email) return 'unmatched';
  const rider = await resolveTravellerByEmail(email);
  if (!rider) return 'unmatched';

  // Idempotency: dedupe on the navan:booking-style prefix.
  const dup = await prisma.bill.findFirst({
    where: { supplierInvoiceNumber: { startsWith: uberRef } },
    select: { id: true },
  });
  if (dup) return 'skipped';

  const amountDollars = extractAmountDollars(t);
  if (amountDollars === null || amountDollars <= 0) {
    console.warn(`[uber.sync] trip ${tripId} has no resolvable amount, skipping`);
    return 'skipped';
  }
  const amountCents = Math.round(amountDollars * 100);
  // GST is bundled in the total for AU rides; Uber's response
  // sometimes exposes a `tax` field. Pull defensively, default to 0.
  const taxDollars = (() => {
    const v = pick(t, 'tax', 'tax_amount', 'gst');
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && !isNaN(Number(v))) return Number(v);
    return 0;
  })();
  const gstCents = Math.round(taxDollars * 100);

  const startDate = extractStartDate(t);
  const projectCode = extractProjectCode(t);
  const projectId = projectCode
    ? (
        await prisma.project.findUnique({
          where: { code: projectCode },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  const startAddr =
    typeof pick(t, 'start_address') === 'object'
      ? (pick(pick(t, 'start_address'), 'display_name', 'address') as
          | string
          | undefined)
      : (pick(t, 'start_address') as string | undefined);
  const endAddr =
    typeof pick(t, 'end_address') === 'object'
      ? (pick(pick(t, 'end_address'), 'display_name', 'address') as
          | string
          | undefined)
      : (pick(t, 'end_address') as string | undefined);
  const tripSummary = [startAddr, endAddr].filter(Boolean).join(' → ');

  const requiredRole = await resolveRequiredRole('bill', amountCents);
  const actor = actorPersonId ?? rider.id;

  await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.create({
      data: {
        supplierName: 'Uber',
        supplierInvoiceNumber: uberRef,
        receivedVia: 'uber_api',
        issueDate: startDate,
        // Firm already paid via AMEX; no real due date — set =
        // issueDate so AP-aging charts don't flag overdue.
        dueDate: startDate,
        amountTotal: amountCents,
        gst: gstCents,
        category: 'travel',
        projectId,
        attributedToPersonId: rider.id,
        status: 'pending_review',
        // The Uber receipt URL goes on attachmentSharepointUrl when
        // present. It's not strictly SharePoint, but the column is
        // the right home for "click to see source receipt" links.
        attachmentSharepointUrl: t.invoice_url ?? null,
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
          source: 'uber_api',
          uber_trip_id: tripId,
          rider_person_id: rider.id,
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
      requestedById: actor,
      summary: `Uber · $${(amountCents / 100).toFixed(0)}${tripSummary ? ` · ${tripSummary}` : ''}`,
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
          via: 'uber_sync',
          uber_trip_id: tripId,
          amount: amountCents,
          rider_person_id: rider.id,
          firm_paid_via: 'amex',
          ...(projectCode
            ? { project_code: projectCode, project_id: projectId }
            : {}),
          ...(tripSummary ? { route: tripSummary } : {}),
        },
      },
      source: 'integration_sync',
    });
  });
  return 'imported';
}
