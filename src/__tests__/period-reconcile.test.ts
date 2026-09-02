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

beforeEach(() => vi.clearAllMocks());

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
      data: { state: 'approved', approvedAt: NOW },
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
      data: { state: 'open', approvedAt: null, lodgedAt: null },
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
  });

  it('handles each month independently when a decision straddles two', async () => {
    tx.timesheetPeriod.findUnique
      .mockResolvedValueOnce(period('lodged'))
      .mockResolvedValueOnce(period('lodged'));
    tx.timesheetEntry.findMany
      .mockResolvedValueOnce(entries('approved'))            // August: done
      .mockResolvedValueOnce(entries('approved', 'submitted')); // September: not

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
