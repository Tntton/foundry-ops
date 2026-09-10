import { describe, it, expect, vi, beforeEach } from 'vitest';
import { monthKeysFor } from '@/server/timesheet';

/**
 * TASK-503 — the period is a ROLL-UP, re-derived from the entries actually in
 * the month, never set from what a single decision did.
 *
 * D2 (TT 2026-08-31): a month closes only when every entry in it is approved,
 * so a contractor spanning three projects gets one invoice rather than three.
 * The failure mode this guards is a manager who leads one of those projects
 * approving their slice and closing the whole month — which would raise an
 * invoice over hours two other managers haven't seen.
 */

const tx = vi.hoisted(() => ({
  timesheetPeriod: { findUnique: vi.fn(), update: vi.fn() },
  timesheetEntry: { findMany: vi.fn() },
  // Closing a month prices the contractor's invoice draft (TASK-504), so
  // reconcile reads the person. Default to full-time: no draft, and the
  // snapshot columns get cleared.
  person: { findUnique: vi.fn() },
  // TASK-509: the invoice now has an expense leg. Default to none so
  // these cases keep testing the hours path in isolation.
  expense: { findMany: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: {} }));

const { reconcileTimesheetPeriodStates } = await import('@/server/timesheet');

const AUG = [{ year: 2026, month: 8 }];
const NOW = new Date('2026-09-05T00:00:00Z');

function period(state: string) {
  return { id: 'per1', state };
}
function entries(...statuses: string[]) {
  return statuses.map((status) => ({ status }));
}

/** Snapshot columns are cleared on every transition that isn't a close. */
const NO_DRAFT = {
  draftRateCents: null,
  draftHours: null,
  draftAmountExGstCents: null,
  draftExpenseTotalCents: null,
  draftExpenseGstCents: null,
  draftExpenseCount: null,
  draftPreparedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.expense.findMany.mockResolvedValue([]);
  tx.person.findUnique.mockResolvedValue({ employment: 'ft', rate: null });
});

describe('monthKeysFor', () => {
  it('dedupes dates down to the months they fall in', () => {
    expect(
      monthKeysFor([
        new Date(Date.UTC(2026, 7, 1)),
        new Date(Date.UTC(2026, 7, 31)),
        new Date(Date.UTC(2026, 8, 1)),
      ]),
    ).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]);
  });

  it('splits a range that straddles a year boundary', () => {
    expect(
      monthKeysFor([new Date(Date.UTC(2026, 11, 31)), new Date(Date.UTC(2027, 0, 1))]),
    ).toEqual([
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
  });
});

describe('reconcileTimesheetPeriodStates', () => {
  it('closes the month only when every entry is approved', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('lodged'));
    tx.timesheetEntry.findMany.mockResolvedValue(entries('approved', 'approved'));

    await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update).toHaveBeenCalledWith({
      where: { id: 'per1' },
      data: { state: 'approved', approvedAt: NOW, ...NO_DRAFT },
    });
  });

  it('leaves the month lodged while any project is still outstanding', async () => {
    // The headline D2 case: one manager cleared their slice, two haven't.
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('lodged'));
    tx.timesheetEntry.findMany.mockResolvedValue(
      entries('approved', 'submitted', 'submitted'),
    );

    await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update).not.toHaveBeenCalled();
  });

  it('reopens the month when something is sent back to draft', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('lodged'));
    tx.timesheetEntry.findMany.mockResolvedValue(entries('approved', 'draft'));

    await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update).toHaveBeenCalledWith({
      where: { id: 'per1' },
      data: { state: 'open', approvedAt: null, lodgedAt: null, ...NO_DRAFT },
    });
  });

  it('never reopens a month that has already been invoiced', async () => {
    // A late send-back must not un-bill a contractor.
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('invoiced'));
    tx.timesheetEntry.findMany.mockResolvedValue(entries('draft'));

    await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update).not.toHaveBeenCalled();
  });

  it('does not create a period for someone who never lodged', async () => {
    // A row existing means the person lodged that month. TASK-504 keys its
    // invoice trigger off that invariant, so approving loose weekly
    // submissions must not conjure a period.
    tx.timesheetPeriod.findUnique.mockResolvedValue(null);

    await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update).not.toHaveBeenCalled();
    expect(tx.timesheetEntry.findMany).not.toHaveBeenCalled();
  });

  it('is a no-op when the state is already right', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('approved'));
    tx.timesheetEntry.findMany.mockResolvedValue(entries('approved'));

    await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update).not.toHaveBeenCalled();
  });

  it('reads exactly the month, not the surrounding weeks', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('lodged'));
    tx.timesheetEntry.findMany.mockResolvedValue(entries('approved'));

    await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    const where = tx.timesheetEntry.findMany.mock.calls[0]![0].where;
    expect(where.date.gte.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(where.date.lt.toISOString().slice(0, 10)).toBe('2026-09-01');
    // No status filter on the roll-up: it has to see draft and submitted
    // rows too, or a month with unapproved hours would look complete.
    expect(where.status).toBeUndefined();
  });

  it('handles each month independently when a decision straddles two', async () => {
    tx.timesheetPeriod.findUnique
      .mockResolvedValueOnce(period('lodged'))
      .mockResolvedValueOnce(period('lodged'));
    tx.timesheetEntry.findMany
      .mockResolvedValueOnce(entries('approved'))            // August roll-up: done
      .mockResolvedValueOnce(entries('approved', 'submitted')); // September roll-up: not

    await reconcileTimesheetPeriodStates(
      tx as never,
      'p1',
      [
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ],
      NOW,
    );

    expect(tx.timesheetPeriod.update).toHaveBeenCalledTimes(1);
    expect(tx.timesheetPeriod.update.mock.calls[0]![0].data.state).toBe('approved');
  });
});

describe('invoice draft snapshot on close', () => {
  it('freezes the contractor rate and amount when the month closes', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('lodged'));
    tx.person.findUnique.mockResolvedValue({ employment: 'contractor', rate: 22_000 });
    tx.timesheetEntry.findMany
      .mockResolvedValueOnce(entries('approved', 'approved'))  // roll-up
      .mockResolvedValueOnce([{ hours: 6 }, { hours: 4 }]);    // pricing read

    await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update).toHaveBeenCalledWith({
      where: { id: 'per1' },
      data: {
        state: 'approved',
        approvedAt: NOW,
        draftRateCents: 22_000,
        draftHours: 10,
        draftAmountExGstCents: 220_000,
        // No expenses in this month, so the pass-through leg is zero
        // rather than absent (TASK-509).
        draftExpenseTotalCents: 0,
        draftExpenseGstCents: 0,
        draftExpenseCount: 0,
        draftPreparedAt: NOW,
      },
    });
  });

  it('prices only APPROVED hours, never anything still in draft', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('lodged'));
    tx.person.findUnique.mockResolvedValue({ employment: 'contractor', rate: 22_000 });
    tx.timesheetEntry.findMany
      .mockResolvedValueOnce(entries('approved'))
      .mockResolvedValueOnce([{ hours: 8 }]);

    await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetEntry.findMany.mock.calls[1]![0].where.status).toBe('approved');
  });

  it('never prepares a draft for full-time staff', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('lodged'));
    tx.person.findUnique.mockResolvedValue({ employment: 'ft', rate: 22_000 });
    tx.timesheetEntry.findMany.mockResolvedValue(entries('approved'));

    const closed = await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(closed[0]!.draft).toBeNull();
    expect(tx.timesheetPeriod.update.mock.calls[0]![0].data).toMatchObject(NO_DRAFT);
  });

  it('prepares no draft when the contractor has no rate on file', async () => {
    // A missing rate is an admin data problem, not something to paper over
    // with a zero-dollar invoice.
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('lodged'));
    tx.person.findUnique.mockResolvedValue({ employment: 'contractor', rate: null });
    tx.timesheetEntry.findMany.mockResolvedValue(entries('approved'));

    const closed = await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(closed[0]!.draft).toBeNull();
  });

  it('clears a stale snapshot when a month is reopened', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('approved'));
    tx.timesheetEntry.findMany.mockResolvedValue(entries('draft'));

    await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(tx.timesheetPeriod.update.mock.calls[0]![0].data).toMatchObject(NO_DRAFT);
  });

  it('reports what closed so the caller can notify', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('lodged'));
    tx.person.findUnique.mockResolvedValue({ employment: 'contractor', rate: 22_000 });
    tx.timesheetEntry.findMany
      .mockResolvedValueOnce(entries('approved'))
      .mockResolvedValueOnce([{ hours: 10 }]);

    const closed = await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW);

    expect(closed).toEqual([
      {
        personId: 'p1',
        year: 2026,
        month: 8,
        monthLabel: 'August 2026',
        draft: {
          rateCents: 22_000,
          hours: 10,
          amountExGstCents: 220_000,
          expenseTotalCents: 0,
          expenseGstCents: 0,
          expenseCount: 0,
        },
      },
    ]);
  });

  it('reports nothing when no month closed', async () => {
    tx.timesheetPeriod.findUnique.mockResolvedValue(period('lodged'));
    tx.timesheetEntry.findMany.mockResolvedValue(entries('submitted'));

    expect(await reconcileTimesheetPeriodStates(tx as never, 'p1', AUG, NOW)).toEqual([]);
  });
});
