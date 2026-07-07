'use server';

import { revalidateScheduleSurfaces } from '@/server/revalidate-schedule';
import { z } from 'zod';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { upsertAvailabilityForPerson } from '@/server/availability';
import { prisma } from '@/server/db';
import { addDays, startOfWeek, todayInFirmTz } from '@/lib/week';

export type AvailabilityFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      cellsWritten: number;
      cellsCleared: number;
      /** Project codes that failed to resolve (archived / renamed between
       *  page load and save). Their cells were saved as unallocated —
       *  surfaced so the user knows the tag was dropped, not silently
       *  swallowed. */
      droppedCodes: string[];
    };

const Schema = z.object({
  personId: z.string().min(1),
  cells: z
    .array(
      z.object({
        dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hours: z.union([z.number().min(0).max(24), z.null()]),
        notes: z.union([z.string().max(500), z.null()]).optional(),
        /** Optional project code (short-form). Server resolves to
         *  Project.id after validating it exists + isn't archived. */
        projectCode: z.union([z.string().max(40), z.null()]).optional(),
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
  // Same capability the page gates on — the handler must enforce it
  // too (deny-by-default; never trust the client).
  if (!hasCapability(session, 'timesheet.submit')) {
    return { status: 'error', message: 'Not authorized' };
  }

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

  // Date-window guard: the editor only renders startOfWeek(now)..+8w;
  // accept a little headroom (16w) but reject anything outside it so a
  // crafted payload can't write forecast rows years into the future.
  const windowStart = startOfWeek(todayInFirmTz());
  const windowEnd = addDays(windowStart, 16 * 7);
  for (const c of valid.data.cells) {
    const d = new Date(`${c.dateIso}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d < windowStart || d >= windowEnd) {
      return {
        status: 'error',
        message: `Date ${c.dateIso} is outside the editable window.`,
      };
    }
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

  // Resolve project codes → project ids. Pull only what's referenced in
  // the payload; archived projects are excluded so a stale forecast
  // cell can't hold onto a dead code.
  const codes = Array.from(
    new Set(
      valid.data.cells
        .map((c) => c.projectCode)
        .filter((c): c is string => typeof c === 'string' && c.length > 0),
    ),
  );
  const projectByCode = new Map<string, string>();
  if (codes.length > 0) {
    const projects = await prisma.project.findMany({
      where: { code: { in: codes }, stage: { not: 'archived' } },
      select: { id: true, code: true },
    });
    for (const p of projects) projectByCode.set(p.code, p.id);
  }
  // Track any code that didn't resolve (archived between page load
  // and save, or a stale option) so the save result can say the tag
  // was dropped rather than silently saving the cell as unallocated.
  const droppedCodes = new Set<string>();
  const cellsForUpsert = valid.data.cells.map((c) => {
    const hasCode = typeof c.projectCode === 'string' && c.projectCode.length > 0;
    const resolved = hasCode ? projectByCode.get(c.projectCode as string) : undefined;
    if (hasCode && resolved === undefined) droppedCodes.add(c.projectCode as string);
    return {
      dateIso: c.dateIso,
      hours: c.hours,
      notes: c.notes ?? null,
      projectId: resolved ?? null,
    };
  });

  // Audit is written inside the same transaction as the mutation (A9).
  const result = await upsertAvailabilityForPerson(personId, cellsForUpsert, {
    actorId: session.person.id,
    via: isSelf ? 'self_availability_forecast' : 'admin_availability_forecast',
  });
  if (!result.ok) return { status: 'error', message: result.error };

  // Reconcile every dependent schedule surface (per-person, project,
  // firm) so dashboards / heatmaps / utilisation all re-render.
  revalidateScheduleSurfaces({ personId });
  return {
    status: 'success',
    cellsWritten: result.cellsWritten,
    cellsCleared: result.cellsCleared,
    droppedCodes: [...droppedCodes],
  };
}
