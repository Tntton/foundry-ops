import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';

/**
 * TASK-516 — editing and deleting an expense after it has been submitted.
 *
 * Three rules carry the whole design:
 *
 *  1. The submitter owns their row until somebody else decides it. In
 *     `draft` / `submitted` they can fix a misread supplier or amount and
 *     delete a duplicate without asking anyone.
 *
 *  2. Past that, only an admin, only with a reason, and an edit RE-OPENS
 *     the approval. A figure someone signed off never silently becomes a
 *     different figure under the same signature.
 *
 *  3. `contractorBillId` is an absolute stop, admins included. The cost is
 *     a line on a contractor's invoice already in the AP queue or paid;
 *     amending the expense underneath would leave bill and expense
 *     disagreeing, and deleting it would orphan an invoiced line.
 *
 * Plus the quiet one: the Uber / Navan intakes dedupe on a reference
 * stored at the front of `description`, so letting a human rewrite the
 * description would destroy the idempotency key and re-import the trip.
 * The reference is stripped for the human and re-attached on save.
 */

const db = vi.hoisted(() => ({
  expense: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  project: { findUnique: vi.fn() },
  approval: { create: vi.fn(), updateMany: vi.fn() },
  auditEvent: { findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', async () => {
  const actual = await vi.importActual<typeof import('@/server/audit')>('@/server/audit');
  return { ...actual, writeAudit: vi.fn() };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/user-updates', () => ({ notifyApproversOfNewApproval: vi.fn() }));
const policies = vi.hoisted(() => ({ resolveRequiredRole: vi.fn() }));
vi.mock('@/server/approval-policies', () => policies);
const sessionMod = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/server/session', () => sessionMod);

const audit = await import('@/server/audit');
const { updateExpense, deleteExpense } = await import(
  '@/app/(app)/expenses/[id]/edit-actions'
);
const { expenseMutationGate, expenseHasHumanEdit } = await import('@/server/expenses');
const { splitExternalRef, joinExternalRef } = await import('@/lib/expense-ref');

const OWNER = 'p-owner';
const ADMIN = 'p-admin';
const OTHER = 'p-other';

function sessionFor(id: string, roles: string[]): Session {
  return {
    person: {
      id,
      email: `${id}@foundry.health`,
      firstName: 'Rachael',
      lastName: 'Spooner',
      initials: 'RS',
      roles: roles as Session['person']['roles'],
      headshotUrl: null,
      band: 'Consultant' as Session['person']['band'],
    },
    realRoles: roles as Session['realRoles'],
    isRealSuperAdmin: roles.includes('super_admin'),
    viewAsRoles: null,
  };
}

function expenseRow(over: Record<string, unknown> = {}) {
  return {
    id: 'exp1',
    personId: OWNER,
    status: 'submitted',
    projectId: null,
    date: new Date('2026-10-02T00:00:00.000Z'),
    amount: 14_250, // $142.50
    gst: 1_295,
    category: 'travel',
    vendor: 'Ubre', // the misread the submitter wants to fix
    description: 'Taxi to Royal Melbourne',
    rebillable: false,
    contractorBillId: null,
    rebilledOnInvoiceId: null,
    approvedById: null,
    approvedAt: null,
    ...over,
  };
}

function editForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('date', '2026-10-02');
  fd.set('amountDollars', '142.50');
  fd.set('gstDollars', '12.95');
  fd.set('category', 'travel');
  fd.set('projectId', '');
  fd.set('vendor', 'Uber');
  fd.set('description', 'Taxi to Royal Melbourne');
  fd.set('intent', 'save');
  fd.set('reason', '');
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

function deleteForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('confirm', 'DELETE');
  fd.set('reason', '');
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

/** The `after` payload of the last writeAudit call. */
function lastAuditAfter(): Record<string, unknown> {
  const calls = vi.mocked(audit.writeAudit).mock.calls;
  const last = calls[calls.length - 1];
  return (last![1].entity.after ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMod.getSession.mockResolvedValue(sessionFor(OWNER, ['staff']));
  db.expense.findUnique.mockResolvedValue(expenseRow());
  db.expense.update.mockResolvedValue({});
  db.expense.delete.mockResolvedValue({});
  db.approval.create.mockResolvedValue({ id: 'appr1' });
  db.approval.updateMany.mockResolvedValue({ count: 1 });
  db.auditEvent.findFirst.mockResolvedValue(null);
  policies.resolveRequiredRole.mockResolvedValue('manager');
  db.$transaction.mockImplementation(async (fn: (t: typeof db) => Promise<unknown>) => fn(db));
});

// ---------------------------------------------------------------------------
// The gate itself — pure, so every combination is cheap to pin down.
// ---------------------------------------------------------------------------

describe('expenseMutationGate — the submitter, pre-approval', () => {
  const owner = { personId: OWNER, isAdmin: false, isSuperAdmin: false };

  for (const status of ['draft', 'submitted'] as const) {
    it(`lets the submitter edit their own ${status} expense with no reason`, () => {
      const verdict = expenseMutationGate(expenseRow({ status }) as never, owner, {
        mutation: 'edit',
      });
      expect(verdict).toEqual({ allowed: true, mode: 'owner', reopensApproval: false });
    });

    it(`lets the submitter delete their own ${status} expense`, () => {
      const verdict = expenseMutationGate(expenseRow({ status }) as never, owner, {
        mutation: 'delete',
      });
      expect(verdict.allowed).toBe(true);
    });
  }
});

describe('expenseMutationGate — approved and beyond', () => {
  const owner = { personId: OWNER, isAdmin: false, isSuperAdmin: false };
  const admin = { personId: ADMIN, isAdmin: true, isSuperAdmin: false };

  for (const status of ['approved', 'rejected', 'reimbursed', 'batched_for_payment'] as const) {
    it(`refuses the submitter once ${status}`, () => {
      const verdict = expenseMutationGate(expenseRow({ status }) as never, owner, {
        mutation: 'edit',
      });
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.code).toBe('needs_admin');
    });

    it(`lets an admin through on ${status}, but only with a reason`, () => {
      const noReason = expenseMutationGate(expenseRow({ status }) as never, admin, {
        mutation: 'edit',
      });
      expect(noReason.allowed).toBe(false);
      if (!noReason.allowed) expect(noReason.code).toBe('needs_reason');

      const withReason = expenseMutationGate(expenseRow({ status }) as never, admin, {
        mutation: 'edit',
        overrideReason: 'Receipt scanned at the wrong amount',
      });
      expect(withReason).toEqual({
        allowed: true,
        mode: 'admin_override',
        // An edit of a decided figure must be re-approved…
        reopensApproval: true,
      });
    });

    it(`does not re-open an approval for a delete on ${status}`, () => {
      const verdict = expenseMutationGate(expenseRow({ status }) as never, admin, {
        mutation: 'delete',
        overrideReason: 'Duplicate of exp2',
      });
      // …whereas a delete cancels it outright, so there is nothing to re-seek.
      expect(verdict).toEqual({
        allowed: true,
        mode: 'admin_override',
        reopensApproval: false,
      });
    });
  }

  it('whitespace is not a reason', () => {
    const verdict = expenseMutationGate(expenseRow({ status: 'approved' }) as never, admin, {
      mutation: 'edit',
      overrideReason: '   ',
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.code).toBe('needs_reason');
  });

  it("an admin editing their OWN approved expense is still an override", () => {
    const verdict = expenseMutationGate(
      expenseRow({ status: 'approved', personId: ADMIN }) as never,
      admin,
      { mutation: 'edit', overrideReason: 'Corrected from the PDF' },
    );
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.mode).toBe('admin_override');
  });
});

describe('expenseMutationGate — somebody else’s expense', () => {
  it('refuses a non-admin outright, even pre-approval', () => {
    const verdict = expenseMutationGate(expenseRow() as never, { personId: OTHER, isAdmin: false, isSuperAdmin: false }, {
      mutation: 'delete',
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.code).toBe('not_owner');
  });

  it("treats an admin touching someone else's draft as an override needing a reason", () => {
    const admin = { personId: ADMIN, isAdmin: true, isSuperAdmin: false };
    const bare = expenseMutationGate(expenseRow({ status: 'draft' }) as never, admin, {
      mutation: 'edit',
    });
    expect(bare.allowed).toBe(false);
    if (!bare.allowed) expect(bare.code).toBe('needs_reason');

    const withReason = expenseMutationGate(expenseRow({ status: 'draft' }) as never, admin, {
      mutation: 'edit',
      overrideReason: 'Fixing on Rachael’s behalf while she is on leave',
    });
    expect(withReason).toEqual({
      allowed: true,
      mode: 'admin_override',
      // Nothing has been signed off yet, so there is no approval to re-open.
      reopensApproval: false,
    });
  });
});

describe('expenseMutationGate — the contractor-bill stop', () => {
  const cases = [
    ['the submitter', { personId: OWNER, isAdmin: false, isSuperAdmin: false }],
    ['an admin', { personId: ADMIN, isAdmin: true, isSuperAdmin: false }],
  ] as const;

  for (const [who, viewer] of cases) {
    for (const mutation of ['edit', 'delete'] as const) {
      it(`refuses ${who} the ${mutation} once contractorBillId is set`, () => {
        const verdict = expenseMutationGate(
          expenseRow({ contractorBillId: 'bill-9' }) as never,
          viewer,
          { mutation, overrideReason: 'I am an admin and I insist' },
        );
        expect(verdict.allowed).toBe(false);
        if (!verdict.allowed) {
          expect(verdict.code).toBe('contractor_bill');
          expect(verdict.message).toMatch(/contractor invoice/i);
        }
      });
    }
  }

  it('holds even in draft — the FK outranks the status', () => {
    const verdict = expenseMutationGate(
      expenseRow({ status: 'draft', contractorBillId: 'bill-9' }) as never,
      { personId: OWNER, isAdmin: false, isSuperAdmin: false },
      { mutation: 'edit' },
    );
    expect(verdict.allowed).toBe(false);
  });

  it('tells the refused where the override lives', () => {
    const verdict = expenseMutationGate(
      expenseRow({ contractorBillId: 'bill-9' }) as never,
      { personId: ADMIN, isAdmin: true, isSuperAdmin: false },
      { mutation: 'edit', overrideReason: 'I insist' },
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.message).toMatch(/Super Admin/i);
  });
});

describe('expenseMutationGate — the Super Admin override (TT, 2026-10-30)', () => {
  // "There always needs to be a super admin override." The contractor-bill
  // lock stops everyone else; it does not stop a super_admin.
  const superAdmin = { personId: ADMIN, isAdmin: true, isSuperAdmin: true };

  for (const mutation of ['edit', 'delete'] as const) {
    it(`lets a super_admin ${mutation} past the contractor-bill lock`, () => {
      const verdict = expenseMutationGate(
        expenseRow({ status: 'approved', contractorBillId: 'bill-9' }) as never,
        superAdmin,
        { mutation, overrideReason: 'Contractor invoiced the wrong trip; bill being reissued' },
      );
      expect(verdict.allowed).toBe(true);
      if (verdict.allowed) expect(verdict.mode).toBe('super_admin_override');
    });
  }

  it('still demands a reason — the override is loud, not silent', () => {
    const verdict = expenseMutationGate(
      expenseRow({ contractorBillId: 'bill-9' }) as never,
      superAdmin,
      { mutation: 'edit' },
    );
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.code).toBe('needs_reason');
  });

  it('re-opens the approval when the row was already decided', () => {
    const verdict = expenseMutationGate(
      expenseRow({ status: 'approved', contractorBillId: 'bill-9' }) as never,
      superAdmin,
      { mutation: 'edit', overrideReason: 'Reissuing the bill' },
    );
    expect(verdict.allowed && verdict.reopensApproval).toBe(true);
  });

  it('leaves a still-pending approval alone — there is no decision to re-seek', () => {
    const verdict = expenseMutationGate(
      expenseRow({ status: 'submitted', contractorBillId: 'bill-9' }) as never,
      superAdmin,
      { mutation: 'edit', overrideReason: 'Reissuing the bill' },
    );
    expect(verdict.allowed && verdict.reopensApproval).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The server actions.
// ---------------------------------------------------------------------------

describe('updateExpense — the submitter fixing their own row', () => {
  for (const status of ['draft', 'submitted'] as const) {
    it(`writes the corrected fields in ${status}`, async () => {
      db.expense.findUnique.mockResolvedValue(expenseRow({ status }));
      const result = await updateExpense('exp1', { status: 'idle' }, editForm());

      expect(result.status).toBe('saved');
      expect(db.expense.update).toHaveBeenCalledTimes(1);
      const data = db.expense.update.mock.calls[0]![0].data;
      expect(data.vendor).toBe('Uber'); // 'Ubre' corrected
      expect(data.amount).toBe(14_250); // integer cents, never float
      expect(data.gst).toBe(1_295);
      // A plain save leaves the status where it was.
      expect(data.status).toBeUndefined();
      expect(data.approvedById).toBeUndefined();
    });
  }

  it('audits the edit with a before/after delta and no override reason', async () => {
    await updateExpense('exp1', { status: 'idle' }, editForm({ amountDollars: '150.00' }));

    expect(audit.writeAudit).toHaveBeenCalledTimes(1);
    const input = vi.mocked(audit.writeAudit).mock.calls[0]![1];
    expect(input.action).toBe('updated');
    expect(input.actor).toEqual({ type: 'person', id: OWNER });
    expect(input.entity.before).toMatchObject({ amount: 14_250, vendor: 'Ubre' });
    expect(input.entity.after).toMatchObject({ amount: 15_000, vendor: 'Uber', mode: 'owner' });
    expect(input.entity.after).not.toHaveProperty('override_reason');
  });

  it('refuses a GST larger than the total before it reaches the database', async () => {
    const result = await updateExpense(
      'exp1',
      { status: 'idle' },
      editForm({ amountDollars: '10.00', gstDollars: '40.00' }),
    );
    expect(result.status).toBe('error');
    expect(db.expense.update).not.toHaveBeenCalled();
  });

  it('submits a draft into the approval queue at the tier its NEW amount earns', async () => {
    db.expense.findUnique.mockResolvedValue(expenseRow({ status: 'draft' }));
    policies.resolveRequiredRole.mockResolvedValue('super_admin'); // over $2k

    const result = await updateExpense(
      'exp1',
      { status: 'idle' },
      editForm({ intent: 'submit', amountDollars: '2400.00', gstDollars: '218.18' }),
    );

    expect(result.status).toBe('submitted');
    expect(policies.resolveRequiredRole).toHaveBeenCalledWith('expense', 240_000);
    expect(db.expense.update.mock.calls[0]![0].data.status).toBe('submitted');
    expect(db.approval.create.mock.calls[0]![0].data).toMatchObject({
      requiredRole: 'super_admin',
      // The OWNER is the claimant, whoever typed the correction.
      requestedById: OWNER,
    });
  });
});

describe('updateExpense — refusals', () => {
  it('refuses the submitter once approved, and touches nothing', async () => {
    db.expense.findUnique.mockResolvedValue(expenseRow({ status: 'approved' }));

    const result = await updateExpense('exp1', { status: 'idle' }, editForm());

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/admin-only/i);
    expect(db.expense.update).not.toHaveBeenCalled();
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it('refuses an admin once contractorBillId is set, reason or not', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor(ADMIN, ['admin']));
    db.expense.findUnique.mockResolvedValue(
      expenseRow({ status: 'approved', contractorBillId: 'bill-9' }),
    );

    const result = await updateExpense(
      'exp1',
      { status: 'idle' },
      editForm({ reason: 'The contractor says the amount was wrong' }),
    );

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/not even by an admin/i);
    expect(db.expense.update).not.toHaveBeenCalled();
  });

  it('refuses a colleague editing a submitted expense that is not theirs', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor(OTHER, ['staff']));

    const result = await updateExpense('exp1', { status: 'idle' }, editForm());

    expect(result.status).toBe('error');
    expect(db.expense.update).not.toHaveBeenCalled();
  });

  it('refuses a manager — approving under $2k is not the same power as rewriting the figure', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor(OTHER, ['manager']));
    db.expense.findUnique.mockResolvedValue(expenseRow({ status: 'approved' }));

    const result = await updateExpense(
      'exp1',
      { status: 'idle' },
      editForm({ reason: 'I approved it so I should be able to fix it' }),
    );

    expect(result.status).toBe('error');
    expect(db.expense.update).not.toHaveBeenCalled();
  });

  it('refuses when not signed in', async () => {
    sessionMod.getSession.mockResolvedValue(null);
    const result = await updateExpense('exp1', { status: 'idle' }, editForm());
    expect(result.status).toBe('error');
    expect(db.expense.update).not.toHaveBeenCalled();
  });
});

describe('updateExpense — the admin override', () => {
  beforeEach(() => {
    sessionMod.getSession.mockResolvedValue(sessionFor(ADMIN, ['admin']));
    db.expense.findUnique.mockResolvedValue(
      expenseRow({ status: 'approved', approvedById: 'p-partner', approvedAt: new Date() }),
    );
  });

  it('records the reason, the actor and the delta on the AuditEvent', async () => {
    const reason = 'Supplier misread by OCR — corrected against the PDF';
    const result = await updateExpense(
      'exp1',
      { status: 'idle' },
      editForm({ reason, amountDollars: '190.00' }),
    );

    expect(result.status).toBe('saved');
    const input = vi.mocked(audit.writeAudit).mock.calls[0]![1];
    expect(input.actor).toEqual({ type: 'person', id: ADMIN });
    expect(input.entity.after).toMatchObject({
      mode: 'admin_override',
      override_reason: reason,
      approval_reopened: true,
      amount: 19_000,
    });
    expect(input.entity.before).toMatchObject({ amount: 14_250, status: 'approved' });
  });

  it('re-opens the approval rather than amending a signed-off figure', async () => {
    await updateExpense('exp1', { status: 'idle' }, editForm({ reason: 'Corrected' }));

    const data = db.expense.update.mock.calls[0]![0].data;
    expect(data.status).toBe('submitted');
    // The old signature was given for a number that is no longer on the row.
    expect(data.approvedById).toBeNull();
    expect(data.approvedAt).toBeNull();

    // Anything still pending is superseded, so the queue never holds two
    // live approvals for one expense…
    expect(db.approval.updateMany).toHaveBeenCalledTimes(1);
    expect(db.approval.updateMany.mock.calls[0]![0].data.status).toBe('rejected');
    // …and a fresh one is opened.
    expect(db.approval.create).toHaveBeenCalledTimes(1);
    expect(db.approval.create.mock.calls[0]![0].data.thresholdContext).toMatchObject({
      reopened_from: 'approved',
      reopened_by: ADMIN,
    });
  });

  it('re-prices the approval tier when the correction crosses the $2k line', async () => {
    policies.resolveRequiredRole.mockResolvedValue('super_admin');

    await updateExpense(
      'exp1',
      { status: 'idle' },
      editForm({ reason: 'Was keyed as $142, receipt says $2,400', amountDollars: '2400.00' }),
    );

    // Re-approval is sought for the NEW figure, not inherited from the old.
    expect(policies.resolveRequiredRole).toHaveBeenCalledWith('expense', 240_000);
    expect(db.approval.create.mock.calls[0]![0].data.requiredRole).toBe('super_admin');
  });

  it('demands a reason before it will do any of that', async () => {
    const result = await updateExpense('exp1', { status: 'idle' }, editForm({ reason: '' }));

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.fieldErrors?.['reason']).toBe('Required');
    expect(db.expense.update).not.toHaveBeenCalled();
  });

  it('flags — but does not block — an expense already rebilled to a client', async () => {
    db.expense.findUnique.mockResolvedValue(
      expenseRow({ status: 'approved', rebilledOnInvoiceId: 'inv-7' }),
    );

    const result = await updateExpense('exp1', { status: 'idle' }, editForm({ reason: 'Fixed' }));

    expect(result.status).toBe('saved');
    expect(lastAuditAfter()).toMatchObject({ warning_rebilled_on_invoice: 'inv-7' });
  });
});

describe('deleteExpense', () => {
  it('lets the submitter delete their own submitted expense', async () => {
    const result = await deleteExpense('exp1', { status: 'idle' }, deleteForm());

    expect(result.status).toBe('deleted');
    expect(db.expense.delete).toHaveBeenCalledWith({ where: { id: 'exp1' } });
  });

  it("refuses to delete someone else's expense", async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor(OTHER, ['staff']));

    const result = await deleteExpense('exp1', { status: 'idle' }, deleteForm());

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/admin-only/i);
    expect(db.expense.delete).not.toHaveBeenCalled();
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it('keeps the whole row in the audit log, since nothing else will hold it', async () => {
    await deleteExpense('exp1', { status: 'idle' }, deleteForm());

    const input = vi.mocked(audit.writeAudit).mock.calls[0]![1];
    expect(input.action).toBe('deleted');
    expect(input.entity.after).toBeNull();
    expect(input.entity.before).toMatchObject({
      personId: OWNER,
      amount: 14_250,
      gst: 1_295,
      vendor: 'Ubre',
      status: 'submitted',
    });
  });

  it('withdraws any approval still waiting on the deleted expense', async () => {
    await deleteExpense('exp1', { status: 'idle' }, deleteForm());

    expect(db.approval.updateMany).toHaveBeenCalledTimes(1);
    const call = db.approval.updateMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ subjectId: 'exp1', status: 'pending' });
    expect(call.data.decisionNote).toMatch(/withdrawn by the submitter/i);
  });

  it('will not delete on a mis-click — the confirmation has to be typed', async () => {
    const result = await deleteExpense('exp1', { status: 'idle' }, deleteForm({ confirm: '' }));

    expect(result.status).toBe('error');
    expect(db.expense.delete).not.toHaveBeenCalled();
  });

  it('refuses an admin once the cost is on a contractor bill', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor(ADMIN, ['admin']));
    db.expense.findUnique.mockResolvedValue(expenseRow({ contractorBillId: 'bill-9' }));

    const result = await deleteExpense(
      'exp1',
      { status: 'idle' },
      deleteForm({ reason: 'Duplicate' }),
    );

    expect(result.status).toBe('error');
    expect(db.expense.delete).not.toHaveBeenCalled();
  });

  it('lets a super_admin through it, and records which lock was broken', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor(ADMIN, ['super_admin']));
    db.expense.findUnique.mockResolvedValue(expenseRow({ contractorBillId: 'bill-9' }));

    const result = await deleteExpense(
      'exp1',
      { status: 'idle' },
      deleteForm({ reason: 'Contractor reissuing the invoice without this line' }),
    );

    expect(result.status).toBe('deleted');
    const input = vi.mocked(audit.writeAudit).mock.calls[0]![1];
    // `after` stays null so the delta still reads as a deletion.
    expect(input.entity.after).toBeNull();
    expect(input.entity.before).toMatchObject({
      deleted_mode: 'super_admin_override',
      override_contractor_bill: 'bill-9',
      override_reason: 'Contractor reissuing the invoice without this line',
    });
  });

  it('records the admin’s reason when one deletes on someone else’s behalf', async () => {
    sessionMod.getSession.mockResolvedValue(sessionFor(ADMIN, ['admin']));
    db.expense.findUnique.mockResolvedValue(expenseRow({ status: 'reimbursed' }));

    const result = await deleteExpense(
      'exp1',
      { status: 'idle' },
      deleteForm({ reason: 'Paid twice — this is the duplicate' }),
    );

    expect(result.status).toBe('deleted');
    expect(db.approval.updateMany.mock.calls[0]![0].data.decisionNote).toMatch(
      /Paid twice/,
    );
  });
});

// ---------------------------------------------------------------------------
// Not clobbering the human's correction.
// ---------------------------------------------------------------------------

describe('OCR must not overwrite a human correction', () => {
  it('reports a human edit from the audit trail the platform already keeps', async () => {
    db.auditEvent.findFirst.mockResolvedValue({ id: 'ae1' });
    await expect(expenseHasHumanEdit(db as never, 'exp1')).resolves.toBe(true);

    const where = db.auditEvent.findFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      entityType: 'expense',
      entityId: 'exp1',
      actorType: 'person',
    });
    // An approval signature is not a correction of the extracted fields.
    expect(where.action.in).toEqual(['updated', 'submitted']);
  });

  it('reports no human edit for an untouched agent-parsed receipt', async () => {
    db.auditEvent.findFirst.mockResolvedValue(null);
    await expect(expenseHasHumanEdit(db as never, 'exp1')).resolves.toBe(false);
  });
});

describe('external sync references survive a human rewrite', () => {
  it('hides the reference from the human', () => {
    expect(splitExternalRef('uber:trip:R-8841 · Uber receipt (email) · Surry Hills')).toEqual({
      ref: 'uber:trip:R-8841',
      text: 'Uber receipt (email) · Surry Hills',
    });
    expect(splitExternalRef('navan:expense:9f21 · Qantas SYD-MEL')).toEqual({
      ref: 'navan:expense:9f21',
      text: 'Qantas SYD-MEL',
    });
  });

  it('leaves a hand-keyed description alone', () => {
    expect(splitExternalRef('Taxi to Royal Melbourne')).toEqual({
      ref: null,
      text: 'Taxi to Royal Melbourne',
    });
    expect(splitExternalRef(null)).toEqual({ ref: null, text: '' });
  });

  it('re-attaches it in the shape the dedupe query matches', () => {
    expect(joinExternalRef('uber:trip:R-8841', 'Cab to the Alfred, not Surry Hills')).toBe(
      'uber:trip:R-8841 · Cab to the Alfred, not Surry Hills',
    );
    // Even when the human clears the text entirely.
    expect(joinExternalRef('uber:trip:R-8841', '')).toBe('uber:trip:R-8841');
    expect(joinExternalRef(null, '')).toBeNull();
  });

  it('does not double the reference if the human pastes it back', () => {
    expect(joinExternalRef('uber:trip:R-8841', 'uber:trip:R-8841 · Cab')).toBe(
      'uber:trip:R-8841 · Cab',
    );
  });

  it('preserves it through a real edit, so the next sync still dedupes', async () => {
    db.expense.findUnique.mockResolvedValue(
      expenseRow({ description: 'uber:trip:R-8841 · Uber receipt (email)' }),
    );

    await updateExpense(
      'exp1',
      { status: 'idle' },
      editForm({ description: 'Cab to the Alfred — wrong pickup on the receipt' }),
    );

    expect(db.expense.update.mock.calls[0]![0].data.description).toBe(
      'uber:trip:R-8841 · Cab to the Alfred — wrong pickup on the receipt',
    );
  });
});
