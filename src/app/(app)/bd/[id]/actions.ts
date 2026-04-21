'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

export type DealUpdateState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

const StageSchema = z.object({
  stage: z.enum(['lead', 'qualifying', 'proposal', 'negotiation', 'won', 'lost']),
});

export async function updateDealStage(
  dealId: string,
  _prev: DealUpdateState,
  formData: FormData,
): Promise<DealUpdateState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = StageSchema.safeParse({ stage: formData.get('stage') });
  if (!parsed.success) return { status: 'error', message: 'Invalid stage' };

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return { status: 'error', message: 'Deal not found' };
  if (deal.stage === parsed.data.stage) {
    return { status: 'success', message: 'No change.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id: dealId },
        data: { stage: parsed.data.stage },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'stage_changed',
        entity: {
          type: 'deal',
          id: dealId,
          before: { stage: deal.stage },
          after: { stage: parsed.data.stage },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[deal.stage] failed:', err);
    return { status: 'error', message: 'Update failed — try again.' };
  }

  revalidatePath('/bd');
  revalidatePath(`/bd/${dealId}`);
  return { status: 'success', message: `Moved to ${parsed.data.stage}.` };
}

const NotesSchema = z.object({
  notes: z.string().trim().max(4000),
});

export async function updateDealNotes(
  dealId: string,
  _prev: DealUpdateState,
  formData: FormData,
): Promise<DealUpdateState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = NotesSchema.safeParse({ notes: formData.get('notes') ?? '' });
  if (!parsed.success) return { status: 'error', message: 'Invalid notes' };

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return { status: 'error', message: 'Deal not found' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id: dealId },
        data: { notes: parsed.data.notes || null },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'notes_updated',
        entity: {
          type: 'deal',
          id: dealId,
          before: { notes: deal.notes ? '(previous)' : null },
          after: { notes: parsed.data.notes ? '(updated)' : null },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[deal.notes] failed:', err);
    return { status: 'error', message: 'Update failed.' };
  }

  revalidatePath(`/bd/${dealId}`);
  return { status: 'success', message: 'Notes saved.' };
}
