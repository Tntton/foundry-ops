import { describe, it, expect, vi } from 'vitest';
import {
  addQuarters,
  auFyOfQuarter,
  auFyQuarterNumber,
  formatQuarterLabel,
  quarterMonths,
  startOfQuarter,
} from '@/lib/week';
import { countLockedCells, isCellEditable } from '@/lib/timesheet-lock';

/**
 * TT 2026-10-23: two complaints about looking back through a timesheet.
 *
 *   1. Stepping back week by week is the only way to reach anything older
 *      than the current month.
 *   2. Hours that have already been approved render as open inputs when you
 *      do get there, so they read as editable. They never were — the save
 *      action has refused to rewrite an approved entry since TASK-023 — so
 *      typing into one silently did nothing.
 *
 * Quarter is a READ-ONLY roll-up by month, not a 90-column grid. Locking is
 * per DAY, because the row-level status collapses to `mixed` on any row that
 * straddles an approval boundary, which is most of them.
 */

describe('quarter boundaries', () => {
  it('snaps any date to the start of its calendar quarter', () => {
    const cases: Array<[string, string]> = [
      ['2026-01-01', '2026-01-01'],
      ['2026-02-17', '2026-01-01'],
      ['2026-03-31', '2026-01-01'],
      ['2026-04-01', '2026-04-01'],
      ['2026-08-15', '2026-07-01'],
      ['2026-12-31', '2026-10-01'],
    ];
    for (const [input, expected] of cases) {
      expect(
        startOfQuarter(new Date(`${input}T00:00:00Z`)).toISOString().slice(0, 10),
      ).toBe(expected);
    }
  });

  it('yields exactly the three months of the quarter', () => {
    const months = quarterMonths(new Date('2026-08-15T00:00:00Z'));
    expect(months.map((m) => m.toISOString().slice(0, 10))).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ]);
  });

  it('steps whole quarters, including across the year boundary', () => {
    const q4 = startOfQuarter(new Date('2026-11-09T00:00:00Z'));
    expect(addQuarters(q4, 1).toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(addQuarters(q4, -1).toISOString().slice(0, 10)).toBe('2026-07-01');
    // Four hops forward must land on the same quarter a year later, never
    // drift onto the 2nd or 3rd of the month the way a fixed ±91d would.
    expect(addQuarters(q4, 4).toISOString().slice(0, 10)).toBe('2027-10-01');
  });

  it('numbers quarters from July, the way the AU FY does', () => {
    const q = (iso: string) => startOfQuarter(new Date(`${iso}T00:00:00Z`));
    expect(auFyQuarterNumber(q('2026-08-15'))).toBe(1); // Jul–Sep
    expect(auFyQuarterNumber(q('2026-11-02'))).toBe(2); // Oct–Dec
    expect(auFyQuarterNumber(q('2026-02-02'))).toBe(3); // Jan–Mar
    expect(auFyQuarterNumber(q('2026-05-02'))).toBe(4); // Apr–Jun
  });

  it('puts a quarter in the FY that contains it', () => {
    const q = (iso: string) => startOfQuarter(new Date(`${iso}T00:00:00Z`));
    // 1 Jul 2026 starts FY27; June 2026 is still FY26.
    expect(auFyOfQuarter(q('2026-07-01'))).toBe(2027);
    expect(auFyOfQuarter(q('2026-06-30'))).toBe(2026);
    expect(auFyOfQuarter(q('2027-03-01'))).toBe(2027);
  });

  it('labels a quarter by both its months and its FY quarter', () => {
    expect(formatQuarterLabel(new Date('2026-08-15T00:00:00Z'))).toBe(
      'Jul–Sep 2026 · FY27 Q1',
    );
    expect(formatQuarterLabel(new Date('2026-02-02T00:00:00Z'))).toBe(
      'Jan–Mar 2026 · FY26 Q3',
    );
  });
});

describe('per-day lock rule', () => {
  const day = (
    status: 'draft' | 'submitted' | 'approved' | 'billed' | null,
    billed = false,
  ) => ({ status, billed });

  it('leaves empty, draft and submitted days editable', () => {
    expect(isCellEditable(day(null), false)).toBe(true);
    expect(isCellEditable(day('draft'), false)).toBe(true);
    // Submitted stays editable — "Recall to draft" is right there, and the
    // save promotes rather than refuses.
    expect(isCellEditable(day('submitted'), false)).toBe(true);
  });

  it('locks an approved day for everyone but a super admin', () => {
    expect(isCellEditable(day('approved'), false)).toBe(false);
    expect(isCellEditable(day('approved'), true)).toBe(true);
  });

  it('locks a day on a document even for a super admin', () => {
    // Both legs count: a client invoice and a contractor bill each give the
    // hour a document to reconcile. The super-admin override stops here —
    // void the document first.
    expect(isCellEditable(day('billed', true), true)).toBe(false);
    expect(isCellEditable(day('approved', true), true)).toBe(false);
  });

  it('counts only days that actually carry hours as locked', () => {
    const cells = [
      { ...day('approved'), hours: 7.5 },
      { ...day('approved'), hours: 0 }, // nothing logged — nothing to lock
      { ...day('draft'), hours: 3 },
      { ...day('billed', true), hours: 8 },
    ];
    expect(countLockedCells(cells, false)).toBe(2);
    // A super admin can still edit the approved day, so only the billed one
    // is locked for them.
    expect(countLockedCells(cells, true)).toBe(1);
  });
});

// ─── Quarter roll-up ──────────────────────────────────────────────────────

const db = vi.hoisted(() => ({
  timesheetEntry: { findMany: vi.fn() },
  timesheetPeriod: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

const { getQuarterSummaryForPerson } = await import('@/server/timesheet');

type ProjectMini = {
  id: string;
  code: string;
  name: string;
  stage: 'kickoff' | 'delivery' | 'closing' | 'archived' | 'standing' | 'benched';
};
const FHP: ProjectMini = { id: 'p1', code: 'FHP001', name: 'Galileo', stage: 'delivery' };
const FHB: ProjectMini = { id: 'p2', code: 'FHB002', name: 'Kepler', stage: 'closing' };

function entry(
  project: ProjectMini,
  iso: string,
  hours: number,
  status: 'draft' | 'submitted' | 'approved',
  legs: { billedInvoiceId?: string | null; contractorBillId?: string | null } = {},
) {
  return {
    project,
    date: new Date(`${iso}T00:00:00Z`),
    hours,
    status,
    billedInvoiceId: legs.billedInvoiceId ?? null,
    contractorBillId: legs.contractorBillId ?? null,
  };
}

describe('getQuarterSummaryForPerson', () => {
  it('rolls hours up by project and month, and reports what is locked', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      entry(FHP, '2026-07-06', 8, 'approved'),
      entry(FHP, '2026-07-07', 4, 'approved'),
      entry(FHP, '2026-08-03', 6, 'submitted'),
      entry(FHB, '2026-09-21', 5, 'draft'),
      entry(FHB, '2026-09-22', 3, 'approved', { billedInvoiceId: 'inv1' }),
    ]);
    db.timesheetPeriod.findMany.mockResolvedValue([
      { year: 2026, month: 7, state: 'invoiced' },
      { year: 2026, month: 8, state: 'lodged' },
    ]);

    const s = await getQuarterSummaryForPerson(
      'me',
      new Date('2026-08-15T00:00:00Z'),
    );

    expect(s.quarterStart.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(s.months.map((m) => m.label)).toEqual([
      'Jul 2026',
      'Aug 2026',
      'Sep 2026',
    ]);
    // A month with no TimesheetPeriod row IS open — the row is written by
    // lodging, not by looking at the month.
    expect(s.months.map((m) => m.state)).toEqual(['invoiced', 'lodged', 'open']);
    expect(s.months.map((m) => m.hours)).toEqual([12, 6, 8]);

    // Rows sort by project code, and carry one cell per month.
    expect(s.rows.map((r) => r.projectCode)).toEqual(['FHB002', 'FHP001']);
    const fhp = s.rows.find((r) => r.projectCode === 'FHP001')!;
    expect(fhp.cells.map((c) => c.hours)).toEqual([12, 6, 0]);
    expect(fhp.cells.map((c) => c.status)).toEqual([
      'approved',
      'submitted',
      'none',
    ]);
    expect(fhp.totalHours).toBe(18);

    expect(s.totalHours).toBe(26);
    // approved 12 + billed 3
    expect(s.lockedHours).toBe(15);
    expect(s.submittedHours).toBe(6);
    expect(s.draftHours).toBe(5);
  });

  it('calls a month holding more than one status mixed, and says how much is locked', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      entry(FHP, '2026-08-03', 8, 'approved'),
      entry(FHP, '2026-08-04', 2, 'draft'),
    ]);
    db.timesheetPeriod.findMany.mockResolvedValue([]);

    const s = await getQuarterSummaryForPerson(
      'me',
      new Date('2026-08-15T00:00:00Z'),
    );
    const aug = s.rows[0]!.cells[1]!;
    expect(aug.status).toBe('mixed');
    expect(aug.hours).toBe(10);
    // "8.0h locked" is the useful read on a mixed month, not the word mixed.
    expect(aug.lockedHours).toBe(8);
  });

  it('reads `billed` from the AR leg only, and locks on either leg', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([
      // On a contractor bill (AP) but not a client invoice (AR): still
      // `approved` for display, still locked for editing.
      entry(FHP, '2026-07-06', 4, 'approved', { contractorBillId: 'bill1' }),
    ]);
    db.timesheetPeriod.findMany.mockResolvedValue([]);

    const s = await getQuarterSummaryForPerson(
      'me',
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(s.rows[0]!.cells[0]!.status).toBe('approved');
    expect(s.lockedHours).toBe(4);
  });

  it('returns an empty roll-up rather than throwing on a quarter with no hours', async () => {
    db.timesheetEntry.findMany.mockResolvedValue([]);
    db.timesheetPeriod.findMany.mockResolvedValue([]);

    const s = await getQuarterSummaryForPerson(
      'me',
      new Date('2026-05-02T00:00:00Z'),
    );
    expect(s.rows).toEqual([]);
    expect(s.totalHours).toBe(0);
    // Months are still named, so the empty state can link into each one.
    expect(s.months.map((m) => m.label)).toEqual([
      'Apr 2026',
      'May 2026',
      'Jun 2026',
    ]);
  });
});
