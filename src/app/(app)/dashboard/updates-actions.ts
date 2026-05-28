'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/server/session';
import { markAllUpdatesRead } from '@/server/user-updates';

/**
 * Mark every unread UserUpdate row for the current viewer as read.
 * Called from the dashboard card when it mounts (auto) or from the
 * "Mark all read" button (manual). The nav badge re-renders to zero
 * after revalidation.
 */
export async function markMyUpdatesRead(): Promise<{ status: 'ok'; cleared: number } | { status: 'error' }> {
  const session = await getSession();
  if (!session) return { status: 'error' };
  const cleared = await markAllUpdatesRead(session.person.id);
  // Refresh layout (so the nav badge re-renders) and dashboard.
  revalidatePath('/', 'layout');
  return { status: 'ok', cleared };
}
