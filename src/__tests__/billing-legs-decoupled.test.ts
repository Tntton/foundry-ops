import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TASK-500 — the AP leg (contractor invoices Foundry) and the AR leg
 * (Foundry invoices the client) must never gate each other.
 *
 * The original bug: `generateDraftBillFromHours` marked consumed hours
 * `status = 'billed'`, and `previewInvoiceFromTimesheets` filters
 * `status = 'approved'` — so billing a contractor silently and permanently
 * removed those hours from the client-invoice pool. Symmetrically, the
 * contractor's own candidate query filtered `billedInvoiceId: null`, so
 * invoicing the client first withheld the contractor's hours.
 *
 * These tests assert the WHERE clauses each side actually sends, because the
 * clause is precisely what was wrong. A behavioural assertion over mocked
 * rows would pass even with the old gates restored.
 */

const db = vi.hoisted(() => ({
  project: { findUniqueOrThrow: vi.fn() },
  person: { findUnique: vi.fn() },
  timesheetEntry: { findMany: vi.fn() },
  bill: { findMany: vi.fn() },
  expense: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import { previewInvoiceFromTimesheets } from '@/server/invoice-drafter';
import {
  isBilledEitherLeg,
  listContractorBillableEntries,
  toDisplayStatus,
} from '@/server/timesheet';
import { computeDelta } from '@/server/audit';

const PERIOD_START = new Date('2026-08-01T00:00:00Z');
const PERIOD_END = new Date('2026-09-01T00:00:00Z');

/** A timesheet row shaped like the AR-leg select in invoice-drafter. */
function arRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'te1',
    hours: 8,
    personId: 'p1',
    person: {
      id: 'p1',
      initials: 'JN',
      headshotUrl: null,
      firstName: 'Jas',
      lastName: 'Navarro',
      billRate: 45_000, // $450/h in cents
      rate: 22_000,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.project.findUniqueOrThrow.mockResolvedValue({
    id: 'proj1',
    code: 'CAC001',
    name: 'Capability Assessment',
    clientId: 'cli1',
  });
  db.bill.findMany.mockResolvedValue([]);
  db.expense.findMany.mockResolvedValue([]);
  db.person.findUnique.mockResolvedValue({
    rate: 22_000,
    billRate: 45_000,
    employment: 'contractor',
  });
});

describe('AR leg — client invoicing ignores the contractor bill', () => {
  it('does not filter on contractorBillId at all', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]);
    await previewInvoiceFromTimesheets('proj1', PERIOD_START, PERIOD_END);

    const where = db.timesheetEntry.findMany.mock.calls[0]![0].where;
    expect(where.status).toBe('approved');
    expect(where.billedInvoiceId).toBeNull();
    // The whole point: an hour already on a contractor bill is still
    // billable to the client.
    expect(where).not.toHaveProperty('contractorBillId');
  });

  it('bills an hour that is already on a contractor bill', async () => {
    // Regression guard for the original defect. Pre-TASK-500 this row would
    // have carried status='billed' and been filtered out entirely.
    db.timesheetEntry.findMany.mockResolvedValue([
      arRow({ id: 'already-on-a-contractor-bill' }),
    ]);
    const preview = await previewInvoiceFromTimesheets('proj1', PERIOD_START, PERIOD_END);

    expect(preview.perPerson).toHaveLength(1);
    expect(preview.perPerson[0]!.entryIds).toEqual(['already-on-a-contractor-bill']);
    expect(preview.totalHours).toBe(8);
    expect(preview.totalAmountCents).toBe(8 * 45_000);
  });
});

describe('AP leg — contractor billing ignores the client invoice', () => {
  it('gates on contractorBillId, never on billedInvoiceId', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]);
    await listContractorBillableEntries('p1');

    const where = db.timesheetEntry.findMany.mock.calls[0]![0].where;
    expect(where).toEqual({ personId: 'p1', status: 'approved', contractorBillId: null });
    // Whether the client has paid us has no bearing on what we owe the
    // contractor.
    expect(where).not.toHaveProperty('billedInvoiceId');
  });

  it('offers an hour that has already been invoiced to the client', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      {
        id: 'te1',
        hours: 8,
        projectId: 'proj1',
        billedInvoiceId: 'inv-already-sent-to-client',
        contractorBillId: null,
        project: { id: 'proj1', code: 'CAC001', name: 'Capability Assessment' },
      },
    ]);
    const { groups } = await listContractorBillableEntries('p1');

    expect(groups).toHaveLength(1);
    expect(groups[0]!.hours).toBe(8);
    expect(groups[0]!.costCents).toBe(8 * 22_000);
  });
});

describe('display status is the AR leg only', () => {
  const approved = { status: 'approved' as const };

  it('reads `billed` from the client invoice', () => {
    expect(
      toDisplayStatus({ ...approved, billedInvoiceId: 'inv1' }),
    ).toBe('billed');
  });

  it('does NOT call an hour billed just because the contractor invoiced us', () => {
    // Every surface using the word says "on invoice" / "linked to invoice".
    // Before TASK-500 the label was driven by the contractor-bill flow, so it
    // counted hours Foundry had been invoiced FOR, not hours it invoiced OUT.
    expect(
      toDisplayStatus({ ...approved, billedInvoiceId: null }),
    ).toBe('approved');
  });

  it('never reports billed for work that has not been approved', () => {
    expect(
      toDisplayStatus({ status: 'draft', billedInvoiceId: 'inv1' }),
    ).toBe('draft');
    expect(
      toDisplayStatus({ status: 'submitted', billedInvoiceId: 'inv1' }),
    ).toBe('submitted');
  });
});

describe('isBilledEitherLeg — the edit-lock / delete-guard predicate', () => {
  it.each([
    ['neither leg', null, null, false],
    ['client invoice only', 'inv1', null, true],
    ['contractor bill only', null, 'bill1', true],
    ['both legs', 'inv1', 'bill1', true],
  ] as const)('%s → %s', (_label, billedInvoiceId, contractorBillId, expected) => {
    expect(isBilledEitherLeg({ billedInvoiceId, contractorBillId })).toBe(expected);
  });
});

describe('backfill contract — the audit payload the migration reads', () => {
  /**
   * The TASK-500 migration recovers historical `status='billed'` rows by
   * reading `entityDelta -> 'created' ->> 'source'` and
   * `entityDelta -> 'created' -> 'timesheetEntryIds'` off the bill's `created`
   * audit event. That JSON path is produced by computeDelta, not hand-written,
   * so this pins the shape: if computeDelta's envelope ever changes, the
   * migration (and any re-run of it) silently stops matching rows.
   */
  it('puts source + timesheetEntryIds where the migration SQL looks', () => {
    const delta = computeDelta(null, {
      source: 'timesheet_draft_bill',
      projectId: 'proj1',
      projectCode: 'CAC001',
      hours: 16,
      billRate: 22_000,
      exGstCents: 352_000,
      gstCents: 35_200,
      totalCents: 387_200,
      timesheetEntryIds: ['te1', 'te2'],
      notes: null,
    }) as { created: Record<string, unknown> };

    expect(delta.created.source).toBe('timesheet_draft_bill');
    expect(delta.created.timesheetEntryIds).toEqual(['te1', 'te2']);
    // jsonb_array_elements_text in the migration requires a real JSON array.
    expect(Array.isArray(delta.created.timesheetEntryIds)).toBe(true);
  });
});
