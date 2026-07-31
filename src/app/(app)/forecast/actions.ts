'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { AdjustmentsSchema, HypotheticalsSchema } from '@/server/reports/forecast';

const PLANNER_ROLES = ['super_admin', 'admin', 'partner'] as const;

export type SaveScenarioState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; scenarioId: string };

const SaveSchema = z.object({
  scenarioId: z.string().trim().optional(),
  name: z.string().trim().min(1, 'Name required').max(120),
  note: z.string().trim().max(500).nullable(),
});

/**
 * Create or update a forecast scenario. Owner-scoped: a scenario is a
 * personal what-if scratchpad. Never touches real project data.
 */
export async function saveScenarioAction(
  _prev: SaveScenarioState,
  formData: FormData,
): Promise<SaveScenarioState> {
  const session = await getSession();
  if (!hasAnyRole(session, PLANNER_ROLES)) {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = SaveSchema.safeParse({
    scenarioId: (formData.get('scenarioId') as string | null)?.trim() || undefined,
    name: (formData.get('name') as string | null) ?? '',
    note: ((formData.get('note') as string | null) ?? '').trim() || null,
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  let adjustments: z.infer<typeof AdjustmentsSchema>;
  let hypotheticals: z.infer<typeof HypotheticalsSchema>;
  try {
    adjustments = AdjustmentsSchema.parse(JSON.parse((formData.get('adjustments') as string) || '[]'));
    hypotheticals = HypotheticalsSchema.parse(
      JSON.parse((formData.get('hypotheticals') as string) || '[]'),
    );
  } catch {
    return { status: 'error', message: 'Invalid scenario adjustments' };
  }

  const personId = session!.person.id;

  try {
    if (parsed.data.scenarioId) {
      const existing = await prisma.scenario.findUnique({
        where: { id: parsed.data.scenarioId },
        select: { ownerId: true },
      });
      if (!existing) return { status: 'error', message: 'Scenario not found' };
      if (existing.ownerId !== personId && !hasAnyRole(session, ['super_admin'])) {
        return { status: 'error', message: 'Not your scenario' };
      }
    }

    const scenario = await prisma.$transaction(async (tx) => {
      const row = parsed.data.scenarioId
        ? await tx.scenario.update({
            where: { id: parsed.data.scenarioId },
            data: { name: parsed.data.name, note: parsed.data.note, adjustments, hypotheticals },
          })
        : await tx.scenario.create({
            data: {
              name: parsed.data.name,
              note: parsed.data.note,
              ownerId: personId,
              adjustments,
              hypotheticals,
            },
          });
      await writeAudit(tx, {
        actor: { type: 'person', id: personId },
        action: parsed.data.scenarioId ? 'updated' : 'created',
        entity: {
          type: 'scenario',
          id: row.id,
          after: {
            name: row.name,
            projectCount: adjustments.length,
            hypotheticalCount: hypotheticals.length,
          },
        },
        source: 'web',
      });
      return row;
    });

    revalidatePath('/forecast');
    return { status: 'success', scenarioId: scenario.id };
  } catch (err) {
    console.error('[forecast.save] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }
}

export async function deleteScenarioAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!hasAnyRole(session, PLANNER_ROLES)) return;
  const scenarioId = (formData.get('scenarioId') as string | null)?.trim();
  if (!scenarioId) return;

  const existing = await prisma.scenario.findUnique({
    where: { id: scenarioId },
    select: { ownerId: true, name: true },
  });
  if (!existing) return;
  if (existing.ownerId !== session!.person.id && !hasAnyRole(session, ['super_admin'])) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.scenario.delete({ where: { id: scenarioId } });
    await writeAudit(tx, {
      actor: { type: 'person', id: session!.person.id },
      action: 'deleted',
      entity: { type: 'scenario', id: scenarioId, before: { name: existing.name } },
      source: 'web',
    });
  });
  revalidatePath('/forecast');
}
