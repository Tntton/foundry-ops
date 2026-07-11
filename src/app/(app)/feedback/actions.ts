'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { writeAudit } from '@/server/audit';
import { notifyAdminPool } from '@/server/user-updates';

const FeedbackSubmit = z.object({
  urgency: z.enum(['critical', 'urgent', 'routine']),
  kind: z.enum(['bug', 'feature', 'maintenance', 'other']),
  title: z.string().trim().min(3, 'Add a short title').max(200),
  body: z.string().trim().min(5, 'Describe the issue / request').max(4000),
  contextPath: z.string().max(500).optional().nullable(),
});

export type FeedbackSubmitState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; id: string };

export async function submitFeedback(
  _prev: FeedbackSubmitState,
  formData: FormData,
): Promise<FeedbackSubmitState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Sign in to submit feedback' };

  const parsed = FeedbackSubmit.safeParse({
    urgency: formData.get('urgency'),
    kind: formData.get('kind') || 'other',
    title: formData.get('title'),
    body: formData.get('body'),
    contextPath: formData.get('contextPath') || null,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  try {
    const ticket = await prisma.$transaction(async (tx) => {
      const t = await tx.feedbackTicket.create({
        data: {
          submitterId: session.person.id,
          urgency: parsed.data.urgency,
          kind: parsed.data.kind,
          title: parsed.data.title,
          body: parsed.data.body,
          contextPath: parsed.data.contextPath ?? null,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'feedback_ticket',
          id: t.id,
          after: { urgency: t.urgency, kind: t.kind, title: t.title },
        },
        source: 'web',
      });
      // Ping the admin pool (TT + admins) the moment anything is
      // raised, so no ticket sits unseen waiting for someone to open
      // /admin/feedback. Critical / urgent items lead the dashboard
      // feed by their prefix.
      const urgencyPrefix =
        t.urgency === 'critical' ? '🔴 Critical' : t.urgency === 'urgent' ? '🟠 Urgent' : 'Routine';
      await notifyAdminPool(tx, {
        actorPersonId: session.person.id,
        kind: 'generic',
        title: `Feedback · ${urgencyPrefix} — ${t.title}`,
        body: `${t.kind} raised by ${session.person.firstName} ${session.person.lastName}`,
        href: '/admin/feedback',
        entityType: 'feedback_ticket',
        entityId: t.id,
      });
      return t;
    });
    revalidatePath('/admin/feedback');
    return { status: 'success', id: ticket.id };
  } catch (err) {
    console.error('[feedback.submit] failed:', err);
    return { status: 'error', message: 'Submission failed — try again.' };
  }
}
