import type { Role } from '@prisma/client';

export type SessionPerson = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  initials: string;
  roles: Role[];
};

export type Session = {
  person: SessionPerson;
};

export function hasRole(session: Session | null, role: Role): boolean {
  return !!session && session.person.roles.includes(role);
}

export function hasAnyRole(session: Session | null, roles: readonly Role[]): boolean {
  if (!session || roles.length === 0) return false;
  return roles.some((r) => session.person.roles.includes(r));
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
