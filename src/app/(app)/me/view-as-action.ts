'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { Role } from '@prisma/client';
import { getSession, VIEW_AS_COOKIE } from '@/server/session';
import { canOverlayAs } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { prisma } from '@/server/db';

const VALID_ROLES: readonly Role[] = [
  'super_admin',
  'admin',
  'partner',
  'associate_partner',
  'manager',
  'staff',
];

/**
 * Toggle the "view as" overlay. Sets a short-lived cookie containing the
 * role-set the person wants to preview.
 *
 *   - Pass `null` to clear the overlay (return to real roles).
 *   - Super_admins and admins can engage; anyone else is refused.
 *   - The requested role-set must be a strict capability *downgrade* of
 *     the person's real roles (canOverlayAs). This is what lets an admin
 *     "view as" a contractor/staff member to see their surface, while
 *     making it impossible for an admin to overlay super_admin (or any
 *     role granting a capability they lack). Re-checked in getSession on
 *     every request, so this is defence-in-depth, not the only gate.
 *
 * The overlay only changes WHAT the user sees / can do — audit trail
 * still attributes mutations to the real personId.
 */
export async function setViewAsRoles(
  roles: Role[] | null,
): Promise<{ ok: boolean; message?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Not signed in' };
  const mayViewAs =
    session.isRealSuperAdmin || session.realRoles.includes('admin');
  if (!mayViewAs) {
    return { ok: false, message: 'You can’t switch view modes.' };
  }

  const jar = cookies();
  if (roles === null || roles.length === 0) {
    jar.delete(VIEW_AS_COOKIE);
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'session',
          id: session.person.id,
          after: { via: 'view_as_cleared' },
        },
        source: 'web',
      });
    });
  } else {
    const sanitised = roles.filter((r) => VALID_ROLES.includes(r));
    if (sanitised.length === 0) {
      return { ok: false, message: 'Invalid role selection.' };
    }
    // Escalation guard: the overlay must grant strictly fewer
    // capabilities than the person's real roles. Blocks e.g. an admin
    // trying to view-as super_admin.
    if (!canOverlayAs(sanitised, session.realRoles)) {
      return {
        ok: false,
        message: 'You can only view as a role with fewer permissions than your own.',
      };
    }
    // Bind the overlay to the person + a snapshot of their real roles at
    // set-time. getSession discards the overlay if either changes, so a
    // preview can never outlive the role-set it was created under (and a
    // leftover cookie can't strip a person whose access was just changed
    // in the platform). `roles` is what they're previewing as.
    const overlay = {
      sub: session.person.id,
      rr: [...session.realRoles].sort(),
      roles: sanitised,
    };
    jar.set(VIEW_AS_COOKIE, JSON.stringify(overlay), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      // Short-lived so the overlay doesn't persist across days. 4 hours
      // is enough for a single review session and forces the super
      // admin to re-engage deliberately.
      maxAge: 4 * 60 * 60,
      path: '/',
    });
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'session',
          id: session.person.id,
          after: {
            via: 'view_as_set',
            viewAsRoles: sanitised,
          },
        },
        source: 'web',
      });
    });
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
