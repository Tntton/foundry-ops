import { cookies } from 'next/headers';
import type { Role } from '@prisma/client';
import { auth } from '@/server/auth';
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
  // Read directly from the JWT — the jwt() callback already cached
  // the person fields at sign-in, so we skip a DB roundtrip on every
  // authenticated page render. Was the dominant per-page tax.
  const authSession = await auth();
  const user = authSession?.user as
    | {
        personId?: string;
        email?: string;
        firstName?: string;
        lastName?: string;
        initials?: string;
        headshotUrl?: string | null;
        roles?: Role[];
      }
    | undefined;
  const personId = user?.personId;
  if (!personId || !user) return null;

  const roles: Role[] = user.roles ?? [];
  const isRealSuperAdmin = roles.includes('super_admin');
  const viewAsRoles = isRealSuperAdmin ? readViewAsCookie() : null;
  const effectiveRoles = viewAsRoles ?? roles;

  return {
    person: {
      id: personId,
      email: user.email ?? '',
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      initials: user.initials ?? '',
      headshotUrl: user.headshotUrl ?? null,
      roles: effectiveRoles,
    },
    isRealSuperAdmin,
    viewAsRoles,
  };
}
