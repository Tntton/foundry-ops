'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { Role } from '@prisma/client';
import { getSession, VIEW_AS_COOKIE } from '@/server/session';
import { writeAudit } from '@/server/audit';
import { prisma } from '@/server/db';

const VALID_ROLES: readonly Role[] = [
  'super_admin',
  'admin',
  'partner',
  'manager',
  'staff',
];

/**
 * Toggle the super-admin "view as" overlay. Sets a short-lived cookie
 * containing the role-set the super_admin wants to pretend to be.
 *
 *   - Pass `null` to clear the overlay (return to real roles).
 *   - Only the underlying super_admin can engage; for anyone else this
 *     refuses silently (UI doesn't expose it).
 *
 * The overlay only changes WHAT the user sees / can do — audit trail
 * still attributes mutations to the real personId.
 */
export async function setViewAsRoles(
  roles: Role[] | null,
): Promise<{ ok: boolean; message?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Not signed in' };
  if (!session.isRealSuperAdmin) {
    return { ok: false, message: 'Only super admins can switch view modes.' };
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
    jar.set(VIEW_AS_COOKIE, JSON.stringify(sanitised), {
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
