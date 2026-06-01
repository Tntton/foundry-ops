'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const PatchInput = z.object({
  id: z.string().min(1),
  notes: z.string().max(4000).optional().nullable(),
  lessonsLearned: z.string().max(4000).optional().nullable(),
});

export type PatchOutcomeState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

/**
 * Inline-edit action for BD outcome notes + lessons learned. Used by
 * /bd/outcomes so partners can append insights without bouncing to
 * the full deal detail page. Audit trail on every change.
 */
export async function patchDealOutcome(
  _prev: PatchOutcomeState,
  formData: FormData,
): Promise<PatchOutcomeState> {
  const session = await getSession();
  if (!session || !hasCapability(session, 'deal.edit')) {
    return { status: 'error', message: 'Not authorized' };
  }

  const raw = {
    id: formData.get('id'),
    notes: formData.get('notes'),
    lessonsLearned: formData.get('lessonsLearned'),
  };
  const parsed = PatchInput.safeParse({
    id: raw.id,
    notes: raw.notes === '' ? null : raw.notes,
    lessonsLearned: raw.lessonsLearned === '' ? null : raw.lessonsLearned,
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid input' };
  }

  const existing = await prisma.deal.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { status: 'error', message: 'Deal not found' };

  const patch: { notes?: string | null; lessonsLearned?: string | null } = {};
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  if (parsed.data.lessonsLearned !== undefined)
    patch.lessonsLearned = parsed.data.lessonsLearned;
  if (Object.keys(patch).length === 0) return { status: 'success' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.deal.update({ where: { id: parsed.data.id }, data: patch });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'deal',
          id: parsed.data.id,
          before: {
            notes: existing.notes,
            lessonsLearned: existing.lessonsLearned,
          },
          after: patch,
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[deal.outcomes.patch] failed:', err);
    return { status: 'error', message: 'Update failed — try again.' };
  }

  revalidatePath('/bd/outcomes');
  revalidatePath(`/bd/${parsed.data.id}`);
  return { status: 'success' };
}
