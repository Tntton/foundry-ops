'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';

const TriageInput = z.object({
  id: z.string().min(1),
  status: z.enum([
    'open',
    'triaged',
    'approved',
    'in_progress',
    'resolved',
    'declined',
    'duplicate',
  ]),
  triageNotes: z.string().max(4000).optional().nullable(),
  resolutionSummary: z.string().max(4000).optional().nullable(),
});

export type TriageState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function updateFeedbackTriage(
  _prev: TriageState,
  formData: FormData,
): Promise<TriageState> {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = TriageInput.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
    triageNotes:
      formData.get('triageNotes') === '' ? null : formData.get('triageNotes'),
    resolutionSummary:
      formData.get('resolutionSummary') === ''
        ? null
        : formData.get('resolutionSummary'),
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid input' };
  }

  const existing = await prisma.feedbackTicket.findUnique({
    where: { id: parsed.data.id },
  });
  if (!existing) return { status: 'error', message: 'Ticket not found' };

  const isTerminalNew =
    ['approved', 'declined', 'resolved'].includes(parsed.data.status) &&
    !['approved', 'declined', 'resolved'].includes(existing.status);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.feedbackTicket.update({
        where: { id: parsed.data.id },
        data: {
          status: parsed.data.status,
          triageNotes:
            parsed.data.triageNotes !== undefined
              ? parsed.data.triageNotes
              : existing.triageNotes,
          resolutionSummary:
            parsed.data.resolutionSummary !== undefined
              ? parsed.data.resolutionSummary
              : existing.resolutionSummary,
          decidedAt: isTerminalNew ? new Date() : existing.decidedAt,
          decidedById: isTerminalNew ? session!.person.id : existing.decidedById,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'updated',
        entity: {
          type: 'feedback_ticket',
          id: parsed.data.id,
          before: { status: existing.status },
          after: { status: parsed.data.status },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[feedback.triage] failed:', err);
    return { status: 'error', message: 'Update failed — try again.' };
  }

  revalidatePath('/admin/feedback');
  return { status: 'success' };
}
