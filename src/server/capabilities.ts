import type { Role } from '@prisma/client';
import { UnauthorizedError, type Session } from '@/server/roles';

/**
 * Canonical capability catalog. Every server action that mutates or exposes
 * sensitive data must gate itself on one of these. Add new capabilities here;
 * the CAPABILITY_ROLES table below is the single source of truth for which
 * roles can do what.
 *
 * Context-dependent rules (e.g. "manager can approve expenses on own project
 * only") are NOT expressed in this table — those checks live in the specific
 * route/handler after hasCapability passes the coarse role gate.
 */
export type Capability =
  | 'invoice.approve.over_20k'
  | 'invoice.approve.under_20k'
  | 'invoice.create'
  | 'invoice.send'
  | 'invoice.delete_draft'
  | 'expense.approve.over_2k'
  | 'expense.approve.under_2k'
  | 'expense.submit'
  | 'bill.approve'
  | 'bill.create'
  | 'bill.delete_draft'
  | 'payrun.approve'
  | 'payrun.create'
  | 'project.create'
  | 'project.edit'
  | 'project.delete'
  | 'person.create'
  | 'person.edit'
  | 'person.delete'
  | 'client.create'
  | 'client.edit'
  | 'client.delete'
  | 'deal.create'
  | 'deal.edit'
  | 'ratecard.edit'
  | 'ratecard.view'
  | 'integration.manage'
  | 'agent.run_manual'
  | 'auditlog.view'
  | 'approval.policy.edit'
  | 'timesheet.submit'
  // Bulk historical timesheet import — the office-manager surface at
  // /admin/import/timesheets. Rows land as `status='approved'` with
  // the importer as `approverId`, so the capability is the same tier
  // as "would normally approve a timesheet". Day-to-day approval
  // happens per-project at the handler level (manager on own project);
  // bulk import is firm-wide and stays admin / partner-tier+.
  | 'timesheet.approve'
  // Partner scorecard (firm-wide partner-attribution view) is
  // gated by capability so Associate Partners can be excluded
  // without losing other partner-level rights. Per the AP tier
  // definition (junior to partner): they DON'T see scorecard but
  // DO get invoice approval, BD ownership, project leadership.
  | 'partner.scorecard.view'
  // Recruitment pipeline — kanban tracker for prospective hires.
  // Super-admin only since the hiring decision is firm-leadership
  // material and the surface contains pre-employment notes about
  // candidates. Different to `person.create` (which is the act of
  // adding the resulting hire) — this is the pre-hire funnel only.
  | 'recruit.manage'
  // DocuSign — initiate e-signature on a contract (CSA / Work Order
  // / contractor agreement / etc). Partner-tier+ because the act of
  // sending creates legal commitment; managers can prepare a doc
  // but the partner needs to send it for signature.
  | 'docusign.send';

export const CAPABILITY_ROLES: Record<Capability, readonly Role[]> = {
  // Invoices — AP gets the same approval + create rights as partner.
  // Over-$20k still super_admin only.
  'invoice.approve.over_20k': ['super_admin'],
  'invoice.approve.under_20k': ['super_admin', 'admin', 'partner', 'associate_partner'],
  'invoice.create': ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'],
  'invoice.send': ['super_admin', 'admin', 'partner', 'associate_partner'],
  // Delete only allowed for pre-approval invoices (draft / pending_approval).
  // Once approved / pushed to Xero, use Xero's void flow instead.
  'invoice.delete_draft': ['super_admin', 'admin', 'partner', 'associate_partner'],

  // Expenses — AP can approve under-$2k (same tier as manager). Over-$2k
  // stays super_admin only.
  'expense.approve.over_2k': ['super_admin'],
  // manager / AP: restricted to own project at the handler level
  'expense.approve.under_2k': ['super_admin', 'admin', 'associate_partner', 'manager'],
  'expense.submit': ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'],

  // Bills (AP) — bill approval still super_admin only; bill creation
  // opened to AP since they manage projects that incur vendor bills.
  'bill.approve': ['super_admin'],
  'bill.create': ['super_admin', 'admin', 'associate_partner'],
  // Only pre-approval bills can be deleted. Approved/scheduled/paid bills are
  // either in Xero or attached to a pay-run — void there, not here.
  'bill.delete_draft': ['super_admin', 'admin', 'associate_partner'],

  // Pay run — unchanged. AP isn't in the pay-run decision chain.
  'payrun.approve': ['super_admin'],
  'payrun.create': ['super_admin', 'admin'],

  // Projects — AP can create + edit projects (they lead them).
  'project.create': ['super_admin', 'admin', 'partner', 'associate_partner'],
  // manager / partner / AP: restricted to own projects at the handler level
  'project.edit': ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'],
  // Hard delete only for super_admin — and handler refuses if the project has
  // any financial children (invoices / bills / expenses / timesheets / deals).
  'project.delete': ['super_admin'],

  // Directory — AP doesn't get directory-admin rights (person create /
  // edit / delete stays admin+). They can still read the directory like
  // anyone else.
  'person.create': ['super_admin', 'admin'],
  'person.edit': ['super_admin', 'admin'],
  // Hard-delete a Person only when they have no transactional footprint at all
  // (no timesheets, expenses, owned clients/projects/deals, team memberships,
  // approvals, risks, or audit events they were actor on). For typical
  // end-of-tenure cases, archive is the right tool — this is strictly for
  // cleaning up mistyped / never-used Person rows.
  'person.delete': ['super_admin'],
  'client.create': ['super_admin', 'admin', 'partner', 'associate_partner'],
  'client.edit': ['super_admin', 'admin', 'partner', 'associate_partner'],
  // Managers get full BD pipeline edit rights (per TT, 2026-07-20) —
  // this cascades to every deal server action + the create/move/edit UI.
  'deal.create': ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'],
  'deal.edit': ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'],
  // Client hard-delete: super_admin only, and handler refuses if the client has
  // any projects / deals / invoices attached. No soft-archive yet — add it with
  // a migration when mid-engagement "close" becomes a need.
  'client.delete': ['super_admin'],

  // Rate card — AP can read the rate card (they need it to price work)
  // but only super_admin can edit it.
  'ratecard.edit': ['super_admin'],
  'ratecard.view': ['super_admin', 'admin', 'partner', 'associate_partner'],

  // System — AP isn't in the firm-admin tier.
  'integration.manage': ['super_admin'],
  'agent.run_manual': ['super_admin', 'admin'],
  'auditlog.view': ['super_admin'],
  'approval.policy.edit': ['super_admin'],

  // Self-service
  'timesheet.submit': ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'],
  // Bulk timesheet import — admin tier + partner/AP. Manager intentionally
  // excluded: per-project approval is fine via the standard workflow, but
  // a firm-wide historical import touches every project and should sit
  // with the same tier that owns the books.
  'timesheet.approve': ['super_admin', 'admin', 'partner', 'associate_partner'],

  // Partner scorecard — explicitly EXCLUDES AP per the AP tier
  // definition. Junior to partner: no scorecard visibility even
  // though they share most other partner-level rights.
  'partner.scorecard.view': ['super_admin', 'admin', 'partner'],

  // Talent pipeline — leadership tier. Originally super_admin only,
  // opened to admin / partner / AP / manager so leaders on the
  // ground (who do most of the sourcing through their networks) can
  // input prospects + be assigned as owners. The pre-employment
  // notes are still sensitive but the audit-event trail captures
  // every view + edit per A9.
  'recruit.manage': [
    'super_admin',
    'admin',
    'partner',
    'associate_partner',
    'manager',
  ],

  // DocuSign send — partner-tier+ (legal commitment). Managers
  // explicitly excluded since signing authority sits at the
  // partner / AP tier. Integration configuration (Connect setup,
  // JWT key rotation) stays gated on `integration.manage` which
  // is super_admin only.
  'docusign.send': ['super_admin', 'admin', 'partner', 'associate_partner'],
};

export function hasCapability(session: Session | null, capability: Capability): boolean {
  if (!session) return false;
  const allowed = CAPABILITY_ROLES[capability];
  return allowed.some((r) => session.person.roles.includes(r));
}

export function requireCapability(
  session: Session | null,
  capability: Capability,
): asserts session is Session {
  if (!session) throw new UnauthorizedError('Not signed in');
  if (!hasCapability(session, capability)) {
    throw new UnauthorizedError(`Missing capability: ${capability}`);
  }
}
