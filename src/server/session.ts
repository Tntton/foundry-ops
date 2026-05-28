import { cookies } from 'next/headers';
import type { Role } from '@prisma/client';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';

export { hasRole, hasAnyRole, requireSession, requireRole, requireAnyRole, UnauthorizedError } from '@/server/roles';
export type { Session, SessionPerson } from '@/server/roles';

export const VIEW_AS_COOKIE = 'fh_view_as_roles';

const ALL_ROLES: readonly Role[] = [
  'super_admin',
  'admin',
  'partner',
  'manager',
  'staff',
];

/**
 * Read the view-as overlay cookie and validate it. Returns null if no
 * overlay is active or the cookie is malformed. Caller is responsible
 * for refusing the overlay when the underlying person isn't a real
 * super_admin (so a regular user can't escalate by setting the cookie).
 */
function readViewAsCookie(): Role[] | null {
  try {
    const raw = cookies().get(VIEW_AS_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter((r): r is Role =>
      typeof r === 'string' && (ALL_ROLES as readonly string[]).includes(r),
    );
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const authSession = await auth();
  const personId = authSession?.user?.personId;
  if (!personId) return null;

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      initials: true,
      headshotUrl: true,
      roles: true,
    },
  });
  if (!person) return null;

  const isRealSuperAdmin = person.roles.includes('super_admin');
  // Only super_admins are allowed to engage the overlay. If a non-
  // super_admin has the cookie set somehow, ignore it.
  const viewAsRoles = isRealSuperAdmin ? readViewAsCookie() : null;
  const effectiveRoles = viewAsRoles ?? person.roles;

  return {
    person: {
      id: person.id,
      email: person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      initials: person.initials,
      headshotUrl: person.headshotUrl,
      roles: effectiveRoles,
    },
    isRealSuperAdmin,
    viewAsRoles,
  };
}
