'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { writeAudit } from '@/server/audit';

/**
 * Mark the current user's first-login onboarding tour as completed
 * (or dismissed — same behavior from the user's POV). Stamps
 * `Person.onboardingCompletedAt` and writes an audit event.
 * Called from the wizard's Finish / Skip actions.
 */
export async function completeOnboarding(reason: 'finished' | 'skipped'): Promise<void> {
  const session = await getSession();
  if (!session) return; // silently no-op; layout will bounce them to signin

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.person.update({
      where: { id: session.person.id },
      data: { onboardingCompletedAt: now },
    });
    await writeAudit(tx, {
      actor: { type: 'person', id: session.person.id },
      action: 'onboarding_completed',
      entity: {
        type: 'Person',
        id: session.person.id,
        before: null,
        after: { reason, at: now.toISOString() },
      },
      source: 'web',
    });
  });

  revalidatePath('/');
}

/**
 * Super-admin only: reset another person's onboarding flag so the
 * tour re-triggers on their next visit. Useful when roles change
 * (e.g. a staff member promoted to manager) and they should see the
 * new role's guide.
 */
export async function resetOnboardingForPerson(personId: string): Promise<void> {
  const session = await getSession();
  if (!session || !session.person.roles.includes('super_admin')) {
    throw new Error('Not authorized');
  }
  await prisma.$transaction(async (tx) => {
    await tx.person.update({
      where: { id: personId },
      data: { onboardingCompletedAt: null },
    });
    await writeAudit(tx, {
      actor: { type: 'person', id: session.person.id },
      action: 'onboarding_reset',
      entity: {
        type: 'Person',
        id: personId,
        before: null,
        after: null,
      },
      source: 'web',
    });
  });
}
