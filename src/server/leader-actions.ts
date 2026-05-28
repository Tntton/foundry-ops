import { prisma } from '@/server/db';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { listStaffPendingActions, type StaffPendingAction } from '@/server/staff-actions';
import { listInvoiceSuggestions } from '@/server/invoice-suggestions';
import type { Session } from '@/server/session';

/**
 * "What does a leader (manager / partner / admin) owe right now?" —
 * the dashboard's leader counterpart to listStaffPendingActions.
 * Role-aware: each tier sees the actions they can actually clear
 * (manager sees their team's timesheets, partner adds BD + invoice
 * approvals, admin adds firm-wide bills + integration health).
 *
 * The cards on the dashboard already surface read-only signal
 * (OperationalQc, BudgetWatch, TeamWeek, FirmOverview, Alerts).
 * This helper is the "what's in your hands to clear" overlay —
 * each row is one tap away from the decision surface.
 *
 * Read-only. Sorted by urgency tone (red > amber > blue).
 */

export type LeaderPendingAction = {
  kind:
    // Approval queues (filtered to what THIS leader can decide)
    | 'bill_approval_queue'
    | 'expense_approval_queue'
    | 'invoice_approval_queue'
    | 'timesheet_approval_queue'
    // Operational signals on projects I lead
    | 'project_stale'
    | 'project_missing_milestones'
    // BD (partner+)
    | 'deal_stale'
    // Invoice generation (partner+)
    | 'invoice_to_draft'
    // Self (carry-through from staff helper)
    | 'self_timesheet_overdue'
    | 'self_timesheet_empty_midweek'
    | 'self_expense_draft'
    | 'self_expense_rejected';
  title: string;
  detail: string;
  href: string;
  tone: 'red' | 'amber' | 'blue';
  /** Pending-row count when this row represents a queue. Used for
   *  badge display on quick-action tiles. */
  count?: number;
};

export type LeaderQuickActionsCount = {
  /** Bills + expenses + invoices pending my approval. */
  approvalsQueue: number;
  /** Submitted timesheet entries from my team / projects I lead. */
  timesheetsToApprove: number;
  /** Open BD deals owned by me (partners only). */
  myBdDeals: number;
  /** Invoice-to-draft suggestions for my projects. */
  invoicesToDraft: number;
};

export type LeaderActionPayload = {
  actions: LeaderPendingAction[];
  counts: LeaderQuickActionsCount;
};

export async function listLeaderPendingActions(
  session: Session,
): Promise<LeaderActionPayload> {
  const personId = session.person.id;
  const isAdmin = hasAnyRole(session, ['super_admin', 'admin']);
  // Associate Partners share partner's invoice / BD / project-
  // leadership surface, so they're grouped with `isPartner` here.
  // The scorecard (and over-$2k expense approvals) stay
  // capability-gated separately.
  const isPartner = hasAnyRole(session, ['partner', 'associate_partner']);
  const isManager = hasAnyRole(session, ['manager']);
  const canApproveBills = hasCapability(session, 'bill.approve');
  const canApproveInvoices = hasCapability(session, 'invoice.approve.under_20k');
  const canApproveExpensesU2k = hasCapability(session, 'expense.approve.under_2k');

  const actions: LeaderPendingAction[] = [];

  // Fan out all the queries up front — they're independent. The for-
  // loops that interpret results stay sequential further down.
  const tsWhere = isAdmin
    ? { status: 'submitted' as const }
    : {
        status: 'submitted' as const,
        project: {
          OR: [{ managerId: personId }, { primaryPartnerId: personId }],
        },
      };
  const [
    billCount,
    expenseCount,
    invoiceCount,
    timesheetsToApprove,
    projectsILead,
    suggestions,
    myDeals,
    selfPending,
  ] = await Promise.all([
    canApproveBills
      ? prisma.approval.count({ where: { status: 'pending', subjectType: 'bill' } })
      : Promise.resolve(0),
    canApproveExpensesU2k
      ? prisma.approval.count({
          where: {
            status: 'pending',
            subjectType: 'expense',
            ...(isManager && !isAdmin && !isPartner
              ? { requiredRole: { in: ['manager', 'partner'] } }
              : {}),
          },
        })
      : Promise.resolve(0),
    canApproveInvoices
      ? prisma.approval.count({ where: { status: 'pending', subjectType: 'invoice' } })
      : Promise.resolve(0),
    isManager || isPartner || isAdmin
      ? prisma.timesheetEntry.count({ where: tsWhere })
      : Promise.resolve(0),
    prisma.project.findMany({
      where: {
        stage: { in: ['kickoff', 'delivery'] },
        ...(isAdmin
          ? {}
          : {
              OR: [{ managerId: personId }, { primaryPartnerId: personId }],
            }),
      },
      select: {
        id: true,
        code: true,
        name: true,
        stage: true,
        startDate: true,
        createdAt: true,
        milestones: { select: { id: true } },
        timesheetEntries: {
          orderBy: { date: 'desc' as const },
          take: 1,
          select: { date: true },
        },
      },
    }),
    isAdmin || isPartner || isManager
      ? listInvoiceSuggestions(session)
      : Promise.resolve([] as Awaited<ReturnType<typeof listInvoiceSuggestions>>),
    isPartner || isAdmin
      ? prisma.deal.findMany({
          where: {
            stage: { in: ['lead', 'qualifying', 'proposal', 'negotiation'] },
            archivedAt: null,
            ...(isAdmin ? {} : { ownerId: personId }),
          },
          select: {
            id: true,
            code: true,
            name: true,
            prospectiveName: true,
            stage: true,
            lastConversationAt: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([] as Array<{
          id: string;
          code: string;
          name: string | null;
          prospectiveName: string | null;
          stage: string;
          lastConversationAt: Date | null;
          updatedAt: Date;
        }>),
    listStaffPendingActions(personId),
  ]);

  // ── 1. Approval queues — bills / expenses / invoices ─────────
  if (canApproveBills && billCount > 0) {
    actions.push({
      kind: 'bill_approval_queue',
      title: `${billCount} bill${billCount === 1 ? '' : 's'} pending your approval`,
      detail: 'Vendor invoices in the AP queue — open to decide.',
      href: '/approvals',
      tone: billCount >= 10 ? 'red' : 'amber',
      count: billCount,
    });
  }
  if (canApproveExpensesU2k && expenseCount > 0) {
    actions.push({
      kind: 'expense_approval_queue',
      title: `${expenseCount} expense${expenseCount === 1 ? '' : 's'} pending approval`,
      detail: 'Receipts submitted by the team — open to decide.',
      href: '/approvals',
      tone: 'amber',
      count: expenseCount,
    });
  }
  if (canApproveInvoices && invoiceCount > 0) {
    actions.push({
      kind: 'invoice_approval_queue',
      title: `${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'} pending approval`,
      detail: 'Drafts awaiting your sign-off before they leave.',
      href: '/approvals',
      tone: 'amber',
      count: invoiceCount,
    });
  }

  // ── 2. Timesheets to approve (manager+) ──────────────────────
  if ((isManager || isPartner || isAdmin) && timesheetsToApprove > 0) {
    actions.push({
      kind: 'timesheet_approval_queue',
      title: `${timesheetsToApprove} timesheet entr${timesheetsToApprove === 1 ? 'y' : 'ies'} to approve`,
      detail: isAdmin
        ? 'Submitted hours across the firm awaiting decision.'
        : 'Hours submitted on projects you lead.',
      href: '/timesheet/approve',
      tone: 'amber',
      count: timesheetsToApprove,
    });
  }

  // ── 3. Project ops gaps on projects I lead ───────────────────
  // Stale = no timesheet activity in 14d for an active project,
  // and the project is >14d old (skip fresh ones). Missing
  // milestones = kickoff stage > 14d old with zero milestones.
  const TWO_WEEKS_MS = 14 * 24 * 3600 * 1000;
  const now = Date.now();
  for (const p of projectsILead) {
    // Skip projects created within the last 14d — they're not stale
    // yet, they're new.
    if (now - p.createdAt.getTime() < TWO_WEEKS_MS) continue;

    // Stale: no timesheet activity in 14d.
    const lastTs = p.timesheetEntries[0]?.date.getTime() ?? 0;
    if (lastTs === 0 || now - lastTs > TWO_WEEKS_MS) {
      const days = lastTs === 0
        ? Math.floor((now - p.createdAt.getTime()) / (24 * 3600 * 1000))
        : Math.floor((now - lastTs) / (24 * 3600 * 1000));
      actions.push({
        kind: 'project_stale',
        title: `${p.code} — no hours logged in ${days}d`,
        detail: `${p.name} · ${p.stage}. Either the project's paused or someone's not logging.`,
        href: `/projects/${p.code}`,
        tone: days >= 30 ? 'red' : 'amber',
      });
    }
    // Missing milestones on kickoff stage.
    if (p.stage === 'kickoff' && p.milestones.length === 0) {
      actions.push({
        kind: 'project_missing_milestones',
        title: `${p.code} — no milestones set`,
        detail: `${p.name} kicked off but hasn't been broken into deliverables yet.`,
        href: `/projects/${p.code}?tab=milestones`,
        tone: 'amber',
      });
    }
  }

  // ── 4. Invoice-to-draft suggestions (partner+) ───────────────
  // (suggestions list already fetched above — use the count for the tile badge.)
  const invoicesToDraft = (isAdmin || isPartner || isManager) ? suggestions.length : 0;

  // ── 5. BD pipeline gaps (partner+) ───────────────────────────
  // Open deals I own with no activity in 14d+ — partner needs to
  // nudge the conversation along.
  const myBdDeals = (isPartner || isAdmin) ? myDeals.length : 0;
  if (isPartner || isAdmin) {
    for (const d of myDeals) {
      const lastTouch = d.lastConversationAt ?? d.updatedAt;
      const ageDays = Math.floor((now - lastTouch.getTime()) / (24 * 3600 * 1000));
      if (ageDays >= 14) {
        actions.push({
          kind: 'deal_stale',
          title: `${d.code} stalling at ${d.stage} (${ageDays}d quiet)`,
          detail: `${d.name ?? d.prospectiveName ?? 'Unnamed deal'} — nudge or move stage.`,
          href: `/bd/${d.id}`,
          tone: ageDays >= 30 ? 'red' : 'amber',
        });
      }
    }
  }

  // ── 6. Self carry-through ────────────────────────────────────
  // Leaders submit timesheets and expenses too. Reuse the staff
  // helper but re-prefix the kinds so the dashboard can render them
  // alongside the leader-specific signals without confusion.
  for (const s of selfPending) {
    actions.push(promoteSelfAction(s));
  }

  // Sort: red > amber > blue, then within each tone keep the order
  // we built (queues first, then project ops, then BD, then self).
  const tonePriority = { red: 0, amber: 1, blue: 2 } as const;
  actions.sort((a, b) => tonePriority[a.tone] - tonePriority[b.tone]);

  // Approval queue total for the headline tile badge.
  const approvalsQueue =
    actions
      .filter((a) =>
        a.kind === 'bill_approval_queue' ||
        a.kind === 'expense_approval_queue' ||
        a.kind === 'invoice_approval_queue',
      )
      .reduce((s, a) => s + (a.count ?? 0), 0);

  return {
    actions,
    counts: {
      approvalsQueue,
      timesheetsToApprove,
      myBdDeals,
      invoicesToDraft,
    },
  };
}

function promoteSelfAction(s: StaffPendingAction): LeaderPendingAction {
  const map: Record<StaffPendingAction['kind'], LeaderPendingAction['kind']> = {
    timesheet_overdue: 'self_timesheet_overdue',
    timesheet_empty_midweek: 'self_timesheet_empty_midweek',
    expense_draft: 'self_expense_draft',
    expense_rejected: 'self_expense_rejected',
  };
  // Prefix with a small "Your" pill in the detail line instead of
  // mangling the title's casing. Original title carries through
  // verbatim so "Finalise expense · Untitled receipt" stays
  // sentence-cased.
  return {
    kind: map[s.kind],
    title: s.title,
    detail: `(your own) · ${s.detail}`,
    href: s.href,
    tone: s.tone,
  };
}
