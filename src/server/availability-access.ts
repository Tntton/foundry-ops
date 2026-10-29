import type { Role } from '@prisma/client';
import { hasAnyRole, type Session } from '@/server/roles';

/**
 * Who may read and edit someone else's availability forecast.
 *
 * Previously each surface repeated its own role array and they had
 * drifted apart: the page admitted super_admin / admin / partner /
 * manager, the two server actions admitted the same four, and
 * `associate_partner` — which `/resource-planning` and the nav config
 * both grant — appeared in none of them, so an AP was rejected
 * server-side even when the UI offered them a person to act on.
 *
 * Single list now, matching the `/resource-planning` gate exactly
 * (TT, 2026-10-23: managers get the same visibility as admin).
 */
export const AVAILABILITY_ON_BEHALF_ROLES: readonly Role[] = [
  'super_admin',
  'admin',
  'partner',
  'associate_partner',
  'manager',
];

/**
 * True when the session may view and edit availability for people other
 * than themselves.
 *
 * Support_Staff are excluded by band rather than by role: the Office
 * Manager holds `admin` for ops work, but the bandwidth surfaces are
 * delivery-side and the nav config already hides them via `denyBands`.
 * Enforced here so the server agrees with the nav.
 */
export function canActOnBehalfForAvailability(session: Session | null): boolean {
  if (!session) return false;
  if (session.person.band === 'Support_Staff') return false;
  return hasAnyRole(session, AVAILABILITY_ON_BEHALF_ROLES);
}
