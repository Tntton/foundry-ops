import type { Role, Band } from '@prisma/client';

export type SessionPerson = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  initials: string;
  roles: Role[];
  headshotUrl: string | null;
  /** The Person.band of the signed-in user. Used by surfaces that need to
   *  filter visibility by band (e.g. Support_Staff don't see delivery-side
   *  planning tools even when they have the admin role). */
  band: Band;
};

export type Session = {
  person: SessionPerson;
  /** True when the signed-in person actually holds super_admin —
   *  preserved across the view-as overlay so the UI knows they can
   *  exit view-as mode. */
  isRealSuperAdmin: boolean;
  /** When the super_admin has engaged "view as", this is the role-set
   *  they're pretending to be. `person.roles` already reflects the
   *  overlay; this field exists so the UI can surface the banner +
   *  exit affordance. Null when no overlay is active. */
  viewAsRoles: Role[] | null;
};

export function hasRole(session: Session | null, role: Role): boolean {
  return !!session && session.person.roles.includes(role);
}

export function hasAnyRole(session: Session | null, roles: readonly Role[]): boolean {
  if (!session || roles.length === 0) return false;
  return roles.some((r) => session.person.roles.includes(r));
}

/**
 * Super_admin is a universal gate override: it can act on any approval row
 * regardless of the row's requiredRole. Non-super_admin viewers only see
 * approvals that match their explicit role.
 *
 * Exposed as a shared helper so the queue list, the dashboard count, the
 * analytics page, and the decide-action authorization check agree on exactly
 * when an approval is visible to the viewer.
 */
export function canActOnApproval(viewerRoles: readonly Role[], requiredRole: Role): boolean {
  if (viewerRoles.includes('super_admin')) return true;
  return viewerRoles.includes(requiredRole);
}

/**
 * Prisma filter fragment — spread into a `where` to scope Approval queries.
 * super_admin gets an empty object (no role filter), so the DB returns every
 * pending approval. Other roles only see rows where requiredRole matches one
 * of their roles.
 */
export function approvalRoleFilter(
  viewerRoles: readonly Role[],
): Record<string, unknown> {
  if (viewerRoles.includes('super_admin')) return {};
  return { requiredRole: { in: viewerRoles } };
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export function requireSession(session: Session | null): asserts session is Session {
  if (!session) throw new UnauthorizedError('Not signed in');
}

export function requireRole(session: Session | null, role: Role): asserts session is Session {
  requireSession(session);
  if (!session.person.roles.includes(role)) {
    throw new UnauthorizedError(`Requires role: ${role}`);
  }
}

export function requireAnyRole(
  session: Session | null,
  roles: readonly Role[],
): asserts session is Session {
  requireSession(session);
  if (!roles.some((r) => session.person.roles.includes(r))) {
    throw new UnauthorizedError(`Requires one of: ${roles.join(', ')}`);
  }
}
