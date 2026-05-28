'use server';

import { revalidateScheduleSurfaces } from '@/server/revalidate-schedule';
import { z } from 'zod';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { upsertAvailabilityForPerson } from '@/server/availability';
import { prisma } from '@/server/db';

export type AvailabilityFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; cellsWritten: number };

const Schema = z.object({
  personId: z.string().min(1),
  cells: z
    .array(
      z.object({
        dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hours: z.union([z.number().min(0).max(24), z.null()]),
        notes: z.union([z.string().max(500), z.null()]).optional(),
      }),
    )
    .max(112), // 16 weeks × 7 days max headroom
});

/**
 * Submit / clear per-day availability forecast cells. Self-edit always
 * works; setting another person's availability requires super_admin /
 * admin / partner / manager.
 */
export async function submitAvailabilityForecast(
  _prev: AvailabilityFormState,
  formData: FormData,
): Promise<AvailabilityFormState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const personId = String(formData.get('personId') ?? '');
  const cellsRaw = formData.get('cells');
  let cells: Array<{
    dateIso: string;
    hours: number | null;
    notes?: string | null;
  }> = [];
  if (typeof cellsRaw === 'string' && cellsRaw.length > 0) {
    try {
      const parsed = JSON.parse(cellsRaw);
      if (Array.isArray(parsed)) cells = parsed;
    } catch {
      return { status: 'error', message: 'Invalid payload' };
    }
  }

  const valid = Schema.safeParse({ personId, cells });
  if (!valid.success) {
    return {
      status: 'error',
      message: valid.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  const isSelf = personId === session.person.id;
  if (!isSelf && !hasAnyRole(session, ['super_admin', 'admin', 'partner', 'manager'])) {
    return {
      status: 'error',
      message: 'Only admin / partner / manager can set someone else\'s forecast.',
    };
  }

  const target = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, endDate: true, inactiveAt: true },
  });
  if (!target) return { status: 'error', message: 'Person not found' };
  if (target.endDate !== null) {
    return { status: 'error', message: 'Person is no longer active.' };
  }
  if (target.inactiveAt !== null) {
    return {
      status: 'error',
      message:
        'Profile is marked inactive — reactivate it to update availability.',
    };
  }

  const result = await upsertAvailabilityForPerson(personId, valid.data.cells);
  if (!result.ok) return { status: 'error', message: result.error };

  // Audit summary — payload kept bounded; we log size, not contents.
  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'person',
          id: personId,
          after: {
            via: isSelf
              ? 'self_availability_forecast'
              : 'admin_availability_forecast',
            cellsWritten: result.cellsWritten,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[availability.submit] audit failed:', err);
  }

  // Reconcile every dependent schedule surface (per-person, project,
  // firm) so dashboards / heatmaps / utilisation all re-render.
  revalidateScheduleSurfaces({ personId });
  return { status: 'success', cellsWritten: result.cellsWritten };
}
