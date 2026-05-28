'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { emitUserUpdate } from '@/server/user-updates';

export type InactiveState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; inactive: boolean };

/**
 * Toggle a person's "inactive" flag.
 *
 *   - Self-edit always allowed (anyone can pause / un-pause themselves).
 *   - Admins (super_admin / admin / partner) can toggle anyone.
 *   - Already-archived (endDate != null) profiles can't be toggled —
 *     archive is the terminal state; reactivate via the archive flow first.
 *
 * Inactive disables all input surfaces (availability, timesheet, …) and
 * excludes the person from FTE / utilisation roll-ups, but they remain
 * visible in the directory and surface in a dedicated "Inactive" pool
 * bucket on resource planning.
 */
export async function setPersonInactive(
  personId: string,
  inactive: boolean,
  _prev: InactiveState,
  _formData: FormData,
): Promise<InactiveState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const isSelf = session.person.id === personId;
  const canActOnBehalf = hasAnyRole(session, [
    'super_admin',
    'admin',
    'partner',
  ]);
  if (!isSelf && !canActOnBehalf) {
    return { status: 'error', message: 'Not authorized' };
  }

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, endDate: true, inactiveAt: true, email: true },
  });
  if (!person) return { status: 'error', message: 'Person not found' };
  if (person.endDate !== null) {
    return {
      status: 'error',
      message:
        'This profile is archived — reactivate it first via the archive panel.',
    };
  }
  const alreadyInactive = person.inactiveAt !== null;
  if (inactive === alreadyInactive) {
    return {
      status: 'error',
      message: inactive
        ? 'Already marked inactive.'
        : 'Already active.',
    };
  }

  const nextInactiveAt = inactive ? new Date() : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: personId },
        data: { inactiveAt: nextInactiveAt },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: inactive ? 'inactive_set' : 'inactive_cleared',
        entity: {
          type: 'person',
          id: personId,
          before: { inactiveAt: person.inactiveAt?.toISOString() ?? null },
          after: { inactiveAt: nextInactiveAt?.toISOString() ?? null },
        },
        source: 'web',
      });

      // Per-person feed: only emit when an admin-on-behalf flips a
      // colleague's status. Self-edits are skipped (the user just
      // clicked the button — they don't need to be told).
      if (!isSelf) {
        await emitUserUpdate(tx, {
          personId,
          kind: inactive ? 'inactive_set' : 'inactive_cleared',
          title: inactive
            ? 'You were marked inactive'
            : 'You were re-activated',
          body: inactive
            ? 'Inputs (availability, timesheet) are paused. Reach out to admin to come back.'
            : null,
          href: `/directory/people/${personId}`,
          entityType: 'person',
          entityId: personId,
        });
      }
    });
  } catch (err) {
    console.error('[person.inactive] failed:', err);
    return {
      status: 'error',
      message: 'Update failed — try again.',
    };
  }

  revalidatePath('/directory');
  revalidatePath(`/directory/people/${personId}`);
  revalidatePath('/resource-planning');
  revalidatePath('/availability');
  revalidatePath('/timesheet');
  return { status: 'success', inactive };
}
