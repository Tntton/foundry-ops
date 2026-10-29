import { cookies } from 'next/headers';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';
import {
  isRole,
  viewAsOverlayApplies,
  type ViewAsOverlay,
} from '@/server/capabilities';

export { hasRole, hasAnyRole, requireSession, requireRole, requireAnyRole, UnauthorizedError } from '@/server/roles';
export type { Session, SessionPerson } from '@/server/roles';

export const VIEW_AS_COOKIE = 'fh_view_as_roles';

/**
 * Read + shape-validate the view-as overlay cookie. Returns null when no
 * overlay is present or the payload is malformed. Identity + real-role
 * binding is enforced by the caller (getSession), which knows the current
 * person; `canOverlayAs` still guards against escalation on top of that.
 *
 * Legacy bare-array cookies (pre-binding) are intentionally rejected here:
 * they carried no identity/role anchor, so treating them as absent both
 * closes the bug and self-heals anyone currently stuck under one.
 */
function readViewAsOverlay(): ViewAsOverlay | null {
  try {
    const raw = cookies().get(VIEW_AS_COOKIE)?.value;
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    const sub = rec['sub'];
    const rrRaw = rec['rr'];
    const rolesRaw = rec['roles'];
    if (typeof sub !== 'string' || !Array.isArray(rrRaw) || !Array.isArray(rolesRaw)) {
      return null;
    }
    const roles = rolesRaw.filter(isRole);
    if (roles.length === 0) return null;
    return { sub, rr: rrRaw.filter(isRole), roles };
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
      band: true,
    },
  });
  if (!person) return null;

  const realRoles = person.roles;
  const isRealSuperAdmin = realRoles.includes('super_admin');
  // Super_admins and admins may engage the overlay. We re-validate it on
  // every request against the person's CURRENT state, and drop it unless
  // ALL of the following hold:
  //   1. the overlay was set by THIS person (sub === person.id) — a
  //      leftover cookie from another account never applies;
  //   2. their real roles are UNCHANGED since the overlay was set
  //      (sameRoleSet) — the moment an admin's roles change in the
  //      platform, any stale preview is discarded rather than left to
  //      keep stripping their real access (the Jas Navarro incident);
  //   3. the overlay is a strict capability downgrade (canOverlayAs) —
  //      the escalation guard: an overlay can never grant a capability
  //      the real person lacks.
  const mayViewAs = isRealSuperAdmin || realRoles.includes('admin');
  const overlay = mayViewAs ? readViewAsOverlay() : null;
  const viewAsRoles = viewAsOverlayApplies(overlay, person.id, realRoles)
    ? overlay!.roles
    : null;
  const effectiveRoles = viewAsRoles ?? realRoles;

  return {
    person: {
      id: person.id,
      email: person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      initials: person.initials,
      headshotUrl: person.headshotUrl,
      roles: effectiveRoles,
      band: person.band,
    },
    realRoles,
    isRealSuperAdmin,
    viewAsRoles,
  };
}
