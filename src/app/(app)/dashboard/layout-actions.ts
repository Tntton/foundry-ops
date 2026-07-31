'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/server/session';
import {
  DASHBOARD_SECTION_KEYS,
  setDashboardLayoutOp,
  type LayoutOp,
} from '@/server/dashboard-sections';

const Schema = z.object({
  op: z.enum([
    'move_up',
    'move_down',
    'move_column',
    'collapse',
    'expand',
    'hide',
    'show',
    'reset',
  ]),
  // Required for every op except `reset`.
  key: z.enum(DASHBOARD_SECTION_KEYS).optional(),
});

/**
 * Move / collapse / hide one leader-dashboard section for the current
 * user. Server-side session check; a user can only ever change their own
 * layout (personId comes from the session, never the client). The
 * mutation is audited inside `setDashboardLayoutOp`.
 */
export async function updateDashboardLayout(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session?.person) return; // not signed in / no person — no-op

  const parsed = Schema.safeParse({
    op: formData.get('op'),
    key: formData.get('key') ?? undefined,
  });
  if (!parsed.success) return;

  const { op, key } = parsed.data;
  let action: LayoutOp;
  if (op === 'reset') {
    action = { op: 'reset' };
  } else {
    if (!key) return; // every non-reset op targets a section
    action = { op, key };
  }

  await setDashboardLayoutOp(session.person.id, action);
  revalidatePath('/');
}
