'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/server/session';
import { markAllUpdatesRead, markUpdatesReadByIds } from '@/server/user-updates';

/**
 * Mark unread UserUpdate rows for the current viewer as read.
 * With `ids`, marks only that set (the dashboard card passes the ids
 * it actually rendered, so items below the fold stay unread and keep
 * their badge). Without `ids`, marks everything — the /updates page's
 * explicit "Mark all read" button.
 */
export async function markMyUpdatesRead(
  ids?: string[],
): Promise<{ status: 'ok'; cleared: number } | { status: 'error' }> {
  const session = await getSession();
  if (!session) return { status: 'error' };
  const cleared = Array.isArray(ids)
    ? await markUpdatesReadByIds(session.person.id, ids.slice(0, 100))
    : await markAllUpdatesRead(session.person.id);
  // Refresh layout (so the nav badge re-renders) and dashboard.
  revalidatePath('/', 'layout');
  return { status: 'ok', cleared };
}
