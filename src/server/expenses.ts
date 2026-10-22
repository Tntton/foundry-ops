import type { ExpenseStatus, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';

export type ExpenseListRow = {
  id: string;
  date: Date;
  amountCents: number;
  gstCents: number;
  category: string;
  vendor: string | null;
  description: string | null;
  status: string;
  project: { id: string; code: string; name: string } | null;
  person: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  };
};

export type ExpenseListFilter = {
  status?: ExpenseStatus;
  category?: string;
  search?: string;
};

/**
 * Role-scoped expense list:
 *  - super_admin / admin: see all
 *  - partner: see own + their projects' team expenses
 *  - manager: see own + their projects' expenses (for approval)
 *  - staff: see own only
 */
export async function listExpenses(
  session: Session,
  scope: 'mine' | 'all' = 'mine',
  filter: ExpenseListFilter = {},
) {
  const personId = session.person.id;
  const roles = session.person.roles;

  const scopeWhere: Record<string, unknown> = {};
  if (
    scope === 'mine' ||
    roles.includes('staff') ||
    (roles.includes('manager') && !roles.some((r) => ['super_admin', 'admin', 'partner'].includes(r)))
  ) {
    if (scope === 'mine') {
      scopeWhere['personId'] = personId;
    } else if (roles.includes('manager')) {
      scopeWhere['OR'] = [
        { personId },
        { project: { managerId: personId } },
      ];
    } else {
      scopeWhere['personId'] = personId;
    }
  }

  const q = filter.search?.trim();
  const searchFilter = q
    ? {
        OR: [
          { vendor: { contains: q, mode: 'insensitive' as const } },
          { description: { contains: q, mode: 'insensitive' as const } },
          { project: { is: { code: { contains: q, mode: 'insensitive' as const } } } },
        ],
      }
    : null;

  const where = {
    ...scopeWhere,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.category ? { category: filter.category } : {}),
    ...(searchFilter ?? {}),
  } as const;

  // Explicit select — `include` returns every scalar column, which
  // drags the receipt attachment (currently a base64 data: URI until
  // SharePoint upload lands) into the 200-row list payload. The list
  // only needs the summary fields.
  const rows = await prisma.expense.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 200,
    select: {
      id: true,
      date: true,
      amount: true,
      gst: true,
      category: true,
      vendor: true,
      description: true,
      status: true,
      project: { select: { id: true, code: true, name: true } },
      person: { select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true } },
    },
  });

  return rows.map<ExpenseListRow>((e) => ({
    id: e.id,
    date: e.date,
    amountCents: e.amount,
    gstCents: e.gst,
    category: e.category,
    vendor: e.vendor,
    description: e.description,
    status: e.status,
    project: e.project,
    person: e.person,
  }));
}

// ============================================================================
// TASK-516 — who may edit or delete an expense, and in which state
// ============================================================================

/**
 * Statuses the submitter may still edit or delete themselves. Everything
 * past these has been decided by somebody else, so the submitter can no
 * longer move it on their own.
 */
export const OWNER_MUTABLE_STATUSES: readonly ExpenseStatus[] = ['draft', 'submitted'];

export type ExpenseMutation = 'edit' | 'delete';

/** The minimum the gate needs to know about the row it is judging. */
export type ExpenseMutationSubject = {
  personId: string;
  status: ExpenseStatus;
  /** Set once a contractor's own invoice carries this cost (TASK-509). */
  contractorBillId: string | null;
  /** Set once the cost has been passed on to a client invoice (AR leg). */
  rebilledOnInvoiceId: string | null;
};

export type ExpenseMutationViewer = {
  personId: string;
  /** Holds `expense.edit.any` / `expense.delete.any` — admin + super_admin. */
  isAdmin: boolean;
};

export type ExpenseGateRefusal =
  /** Someone else's expense, and the viewer is not an admin. */
  | 'not_owner'
  /** Already on a contractor Bill — amend the bill, not the line under it. */
  | 'contractor_bill'
  /** Signed off or paid; only an admin can reach it now. */
  | 'needs_admin'
  /** Admin is acting outside their own pre-approval row and gave no reason. */
  | 'needs_reason';

export type ExpenseGateVerdict =
  | {
      allowed: true;
      /** 'owner' = the submitter fixing their own pre-approval row.
       *  'admin_override' = an admin reaching past that, reason recorded. */
      mode: 'owner' | 'admin_override';
      /** True when the mutation amends a figure that was already signed
       *  off, so the approval has to be re-opened rather than quietly
       *  amended. Edits only — a delete cancels the approval instead. */
      reopensApproval: boolean;
    }
  | { allowed: false; code: ExpenseGateRefusal; message: string };

function humanStatus(status: ExpenseStatus): string {
  return status.replace(/_/g, ' ');
}

/**
 * The single decision point for every expense edit / delete path.
 *
 * Deny-by-default (A6), evaluated in this order:
 *
 *  1. `contractorBillId` set → refused for EVERYONE, admins included. The
 *     cost is already a line on a contractor's invoice sitting in the AP
 *     queue or paid. Editing the expense underneath would leave the bill
 *     saying one thing and the expense another, and deleting it would
 *     orphan an invoiced line. The correction belongs on the bill. This is
 *     deliberately stricter than TASK-516's "approved and beyond is
 *     admin-only" clause, which its own next line carves this case out of
 *     ("never editable once consumed by a contractor bill"). "Every state"
 *     in the admin-override requirement means every `ExpenseStatus`; the
 *     contractor-bill FK is a separate axis and an absolute stop.
 *
 *  2. `draft` / `submitted` → the submitter's own row, theirs to fix. An
 *     admin may also act, but that is an override and needs a reason.
 *
 *  3. `approved` / `rejected` / `reimbursed` / `batched_for_payment` →
 *     admin only, reason required. An edit here re-opens the approval:
 *     the figure someone signed off is no longer the figure on the row,
 *     so the signature has to be sought again rather than inherited.
 *
 * Pure — no DB, no session — so the policy can be tested exhaustively and
 * reused by any surface (web action, future WhatsApp path, admin tools).
 */
export function expenseMutationGate(
  expense: ExpenseMutationSubject,
  viewer: ExpenseMutationViewer,
  opts: { mutation: ExpenseMutation; overrideReason?: string | null },
): ExpenseGateVerdict {
  const verb = opts.mutation === 'delete' ? 'Deleting' : 'Editing';

  // 1. Consumed by a contractor bill — nobody, no override.
  if (expense.contractorBillId !== null) {
    return {
      allowed: false,
      code: 'contractor_bill',
      message: `This expense is already on a contractor invoice, so it can't be ${
        opts.mutation === 'delete' ? 'deleted' : 'edited'
      } here. Amend the bill instead — changing the line underneath would leave the two disagreeing.`,
    };
  }

  const isOwner = expense.personId === viewer.personId;
  const ownerMutable = OWNER_MUTABLE_STATUSES.includes(expense.status);
  const reason = opts.overrideReason?.trim() ?? '';

  // 2. Pre-approval: the submitter's own to fix.
  if (ownerMutable) {
    if (isOwner) return { allowed: true, mode: 'owner', reopensApproval: false };
    if (!viewer.isAdmin) {
      return {
        allowed: false,
        code: 'not_owner',
        message: `${verb} someone else's expense is admin-only.`,
      };
    }
    if (reason === '') {
      return {
        allowed: false,
        code: 'needs_reason',
        message: `Give a reason — this is an admin override on someone else's expense, and it goes in the audit trail.`,
      };
    }
    return { allowed: true, mode: 'admin_override', reopensApproval: false };
  }

  // 3. Signed off or paid.
  if (!viewer.isAdmin) {
    return {
      allowed: false,
      code: 'needs_admin',
      message: `This expense is ${humanStatus(expense.status)} — ${verb.toLowerCase()} it is admin-only now. Ask an admin, and they'll re-open the approval rather than quietly amend a signed-off figure.`,
    };
  }
  if (reason === '') {
    return {
      allowed: false,
      code: 'needs_reason',
      message: `Give a reason — this expense is ${humanStatus(expense.status)} and the override goes in the audit trail.`,
    };
  }
  return {
    allowed: true,
    mode: 'admin_override',
    // A delete cancels the approval outright; only an edit needs it re-sought.
    reopensApproval: opts.mutation === 'edit',
  };
}

/**
 * True once a person (rather than an agent or a sync) has changed the
 * fields on this expense.
 *
 * The guard for TASK-516's last rule: re-running OCR over a receipt must
 * not clobber a correction a human has already made. Rather than add a
 * column that every expense read would then depend on, this reads the
 * record the platform is already required to keep — A9 says every mutation
 * writes an `AuditEvent`, so a human field edit is by definition a
 * person-actor `updated` / `submitted` row against the expense. Approval
 * decisions write `approved` / `rejected` and are correctly NOT counted: a
 * signature is not a correction of the extracted fields.
 *
 * Any path that re-parses a receipt onto an existing Expense MUST call
 * this first and leave the row alone when it returns true. There is no
 * such path today (the OCR intakes only ever create), which is exactly why
 * the guard is landing with the edit feature rather than after it.
 */
export async function expenseHasHumanEdit(
  client: Prisma.TransactionClient,
  expenseId: string,
): Promise<boolean> {
  const row = await client.auditEvent.findFirst({
    where: {
      entityType: 'expense',
      entityId: expenseId,
      actorType: 'person',
      action: { in: ['updated', 'submitted'] },
    },
    select: { id: true },
  });
  return row !== null;
}
