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
  | 'ratecard.edit'
  | 'ratecard.view'
  | 'integration.manage'
  | 'agent.run_manual'
  | 'auditlog.view'
  | 'approval.policy.edit'
  | 'timesheet.submit';

export const CAPABILITY_ROLES: Record<Capability, readonly Role[]> = {
  // Invoices
  'invoice.approve.over_20k': ['super_admin'],
  'invoice.approve.under_20k': ['super_admin', 'admin', 'partner'],
  'invoice.create': ['super_admin', 'admin', 'partner', 'manager'],
  'invoice.send': ['super_admin', 'admin', 'partner'],
  // Delete only allowed for pre-approval invoices (draft / pending_approval).
  // Once approved / pushed to Xero, use Xero's void flow instead.
  'invoice.delete_draft': ['super_admin', 'admin', 'partner'],

  // Expenses
  'expense.approve.over_2k': ['super_admin'],
  // manager: restricted to own project at the handler level
  'expense.approve.under_2k': ['super_admin', 'admin', 'manager'],
  'expense.submit': ['super_admin', 'admin', 'partner', 'manager', 'staff'],

  // Bills (AP)
  'bill.approve': ['super_admin'],
  'bill.create': ['super_admin', 'admin'],

  // Pay run
  'payrun.approve': ['super_admin'],
  'payrun.create': ['super_admin', 'admin'],

  // Projects
  'project.create': ['super_admin', 'admin', 'partner'],
  // manager/partner: restricted to own projects at the handler level
  'project.edit': ['super_admin', 'admin', 'partner', 'manager'],
  // Hard delete only for super_admin — and handler refuses if the project has
  // any financial children (invoices / bills / expenses / timesheets / deals).
  'project.delete': ['super_admin'],

  // Directory
  'person.create': ['super_admin', 'admin'],
  'person.edit': ['super_admin', 'admin'],
  // Hard-delete a Person only when they have no transactional footprint at all
  // (no timesheets, expenses, owned clients/projects/deals, team memberships,
  // approvals, risks, or audit events they were actor on). For typical
  // end-of-tenure cases, archive is the right tool — this is strictly for
  // cleaning up mistyped / never-used Person rows.
  'person.delete': ['super_admin'],
  'client.create': ['super_admin', 'admin', 'partner'],
  'client.edit': ['super_admin', 'admin', 'partner'],
  // Client hard-delete: super_admin only, and handler refuses if the client has
  // any projects / deals / invoices attached. No soft-archive yet — add it with
  // a migration when mid-engagement "close" becomes a need.
  'client.delete': ['super_admin'],

  // Rate card
  'ratecard.edit': ['super_admin'],
  'ratecard.view': ['super_admin', 'admin', 'partner'],

  // System
  'integration.manage': ['super_admin'],
  'agent.run_manual': ['super_admin', 'admin'],
  'auditlog.view': ['super_admin'],
  'approval.policy.edit': ['super_admin'],

  // Self-service
  'timesheet.submit': ['super_admin', 'admin', 'partner', 'manager', 'staff'],
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
