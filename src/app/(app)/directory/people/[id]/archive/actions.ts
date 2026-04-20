'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { setM365UserEnabled } from '@/server/integrations/m365';

export type ArchiveState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const ArchiveSchema = z.object({
  confirmEmail: z.string().trim().toLowerCase(),
  endDate: z.coerce.date().optional(),
});

export async function archivePerson(
  personId: string,
  _prev: ArchiveState,
  formData: FormData,
): Promise<ArchiveState> {
  const session = await getSession();
  try {
    requireCapability(session, 'person.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  if (personId === session.person.id) {
    return {
      status: 'error',
      message:
        'You cannot archive yourself. Ask another admin to archive your profile if you need to leave.',
    };
  }

  const parsed = ArchiveSchema.safeParse({
    confirmEmail: formData.get('confirmEmail'),
    endDate: formData.get('endDate') || undefined,
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) return { status: 'error', message: 'Person not found' };

  if (parsed.data.confirmEmail !== person.email.toLowerCase()) {
    return {
      status: 'error',
      message: `Email didn't match. To confirm, type "${person.email}" exactly.`,
    };
  }

  if (person.endDate !== null) {
    return { status: 'error', message: 'Person is already archived.' };
  }

  const endDate = parsed.data.endDate ?? new Date();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: personId },
        data: { endDate },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'archived',
        entity: {
          type: 'person',
          id: personId,
          before: { endDate: null, email: person.email, initials: person.initials },
          after: { endDate: endDate.toISOString() },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[person.archive] failed:', err);
    return { status: 'error', message: 'Archive failed — try again.' };
  }

  // Best-effort M365 deactivation — archive already succeeded, so even if
  // Graph fails we don't undo. Admin can manually disable in Entra if needed.
  if (person.entraUserId) {
    try {
      await setM365UserEnabled(person.entraUserId, false);
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'm365_disabled',
          entity: {
            type: 'person',
            id: personId,
            after: { entraUserId: person.entraUserId, accountEnabled: false },
          },
          source: 'web',
        });
      });
    } catch (err) {
      console.error('[person.archive] M365 deactivation failed:', err);
      // Surface but don't fail the archive — DB is already updated.
    }
  }

  revalidatePath('/directory');
  revalidatePath(`/directory/people/${personId}`);
  redirect(`/directory/people/${personId}`);
}

export async function reactivatePerson(
  personId: string,
  _prev: ArchiveState,
  _formData: FormData,
): Promise<ArchiveState> {
  const session = await getSession();
  try {
    requireCapability(session, 'person.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) return { status: 'error', message: 'Person not found' };
  if (person.endDate === null) {
    return { status: 'error', message: 'Person is already active.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: personId },
        data: { endDate: null },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'reactivated',
        entity: {
          type: 'person',
          id: personId,
          before: { endDate: person.endDate?.toISOString() ?? null },
          after: { endDate: null },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[person.reactivate] failed:', err);
    return { status: 'error', message: 'Reactivation failed — try again.' };
  }

  // Best-effort M365 re-enable.
  if (person.entraUserId) {
    try {
      await setM365UserEnabled(person.entraUserId, true);
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'm365_enabled',
          entity: {
            type: 'person',
            id: personId,
            after: { entraUserId: person.entraUserId, accountEnabled: true },
          },
          source: 'web',
        });
      });
    } catch (err) {
      console.error('[person.reactivate] M365 re-enable failed:', err);
    }
  }

  revalidatePath('/directory');
  revalidatePath(`/directory/people/${personId}`);
  return { status: 'success' };
}
