'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/server/session';
import {
  ACTION_GROUP_KEYS,
  setDashboardActionGroupPref,
  type GroupOp,
} from '@/server/dashboard-prefs';

const Schema = z.object({
  groupKey: z.enum(ACTION_GROUP_KEYS),
  op: z.enum(['hide', 'snooze', 'clear']),
  // Only meaningful for `snooze`; capped so a stray value can't snooze for years.
  days: z.coerce.number().int().positive().max(90).optional(),
});

/**
 * Hide / snooze / clear one leader-dashboard action group for the current
 * user. Server-side session check; a user can only ever change their own
 * prefs (personId comes from the session, never the client). The mutation
 * is audited inside `setDashboardActionGroupPref`.
 */
export async function updateActionGroupPref(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session?.person) return; // not signed in / no person — no-op

  const parsed = Schema.safeParse({
    groupKey: formData.get('groupKey'),
    op: formData.get('op'),
    days: formData.get('days') ?? undefined,
  });
  if (!parsed.success) return;

  const { groupKey, op, days } = parsed.data;
  let action: GroupOp;
  if (op === 'snooze') {
    if (!days) return; // snooze requires a duration
    action = { op: 'snooze', days };
  } else {
    action = { op };
  }

  await setDashboardActionGroupPref(session.person.id, groupKey, action);
  revalidatePath('/');
}
