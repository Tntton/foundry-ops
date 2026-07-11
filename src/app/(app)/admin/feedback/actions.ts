'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { emitUserUpdate } from '@/server/user-updates';
import { buildFeedbackBrief } from '@/server/feedback-brief';

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
  // Commit SHA / PR URL that carried the fix — captured when the
  // ticket moves to in_progress / resolved.
  commitRef: z.string().max(300).optional().nullable(),
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
    commitRef:
      formData.get('commitRef') === '' ? null : formData.get('commitRef'),
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
  const statusChanged = parsed.data.status !== existing.status;

  // Close the loop back to whoever raised it — a status change is the
  // one thing the submitter actually cares about. Only the milestones
  // that mean something to them (not internal open↔triaged shuffling).
  const submitterMessage: { title: string; body: string } | null = statusChanged
    ? parsed.data.status === 'in_progress'
      ? { title: 'Your feedback is being worked on', body: existing.title }
      : parsed.data.status === 'resolved'
        ? { title: 'Your feedback shipped', body: parsed.data.resolutionSummary ?? existing.title }
        : parsed.data.status === 'declined'
          ? { title: 'Your feedback was declined', body: parsed.data.triageNotes ?? existing.title }
          : parsed.data.status === 'approved'
            ? { title: 'Your feedback was approved', body: existing.title }
            : null
    : null;

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
          commitRef:
            parsed.data.commitRef !== undefined
              ? parsed.data.commitRef
              : existing.commitRef,
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
          after: { status: parsed.data.status, commitRef: parsed.data.commitRef ?? existing.commitRef },
        },
        source: 'web',
      });
      // Notify the submitter (skip if they're the one making the change,
      // e.g. an admin triaging their own ticket).
      if (submitterMessage && existing.submitterId !== session!.person.id) {
        await emitUserUpdate(tx, {
          personId: existing.submitterId,
          kind: 'generic',
          title: submitterMessage.title,
          body: submitterMessage.body,
          href: '/feedback',
          entityType: 'feedback_ticket',
          entityId: parsed.data.id,
        });
      }
    });
  } catch (err) {
    console.error('[feedback.triage] failed:', err);
    return { status: 'error', message: 'Update failed — try again.' };
  }

  revalidatePath('/admin/feedback');
  return { status: 'success' };
}

export type RouteToDevState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; brief: string };

/**
 * Route an approved ticket to a Claude Code chat for implementation.
 * Returns the paste-ready brief (the client copies it to the
 * clipboard), stamps `routedToDevAt`, and advances the ticket to
 * `in_progress` — so routing it IS the "being worked on" signal, and
 * the submitter is notified in the same beat. super_admin / admin only.
 */
export async function routeTicketToDev(
  ticketId: string,
): Promise<RouteToDevState> {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) {
    return { status: 'error', message: 'Not authorized' };
  }

  const ticket = await prisma.feedbackTicket.findUnique({
    where: { id: ticketId },
    include: {
      submitter: { select: { firstName: true, lastName: true, id: true } },
    },
  });
  if (!ticket) return { status: 'error', message: 'Ticket not found' };

  const brief = buildFeedbackBrief({
    id: ticket.id,
    title: ticket.title,
    body: ticket.body,
    kind: ticket.kind,
    urgency: ticket.urgency,
    contextPath: ticket.contextPath,
    triageNotes: ticket.triageNotes,
    submitterName: `${ticket.submitter.firstName} ${ticket.submitter.lastName}`,
  });

  const wasNotInProgress = ticket.status !== 'in_progress';
  try {
    await prisma.$transaction(async (tx) => {
      await tx.feedbackTicket.update({
        where: { id: ticketId },
        data: {
          routedToDevAt: new Date(),
          // Approved → in_progress on routing. Leave terminal states
          // (resolved / declined / duplicate) alone.
          ...(ticket.status === 'approved' || ticket.status === 'triaged' || ticket.status === 'open'
            ? { status: 'in_progress' }
            : {}),
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'updated',
        entity: {
          type: 'feedback_ticket',
          id: ticketId,
          before: { status: ticket.status },
          after: { status: 'in_progress', via: 'route_to_dev' },
        },
        source: 'web',
      });
      if (wasNotInProgress && ticket.submitter.id !== session!.person.id) {
        await emitUserUpdate(tx, {
          personId: ticket.submitter.id,
          kind: 'generic',
          title: 'Your feedback is being worked on',
          body: ticket.title,
          href: '/feedback',
          entityType: 'feedback_ticket',
          entityId: ticketId,
        });
      }
    });
  } catch (err) {
    console.error('[feedback.routeToDev] failed:', err);
    return { status: 'error', message: 'Failed to route — try again.' };
  }

  revalidatePath('/admin/feedback');
  return { status: 'success', brief };
}
