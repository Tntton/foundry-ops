'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { prisma } from '@/server/db';

const ToggleSchema = z.object({
  mailboxUpn: z.string().email(),
  enabled: z.boolean(),
});

export async function toggleMailboxCursor(input: {
  mailboxUpn: string;
  enabled: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthorized' };
  requireCapability(session, 'integration.manage');

  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
  }

  const { mailboxUpn, enabled } = parsed.data;

  const before = await prisma.mailboxPollCursor.findUnique({
    where: { mailboxUpn },
    select: { id: true, enabled: true },
  });
  if (!before) {
    return { ok: false, error: `cursor row not found for ${mailboxUpn}` };
  }
  if (before.enabled === enabled) {
    return { ok: true }; // no-op
  }

  await prisma.$transaction(async (tx) => {
    await tx.mailboxPollCursor.update({
      where: { mailboxUpn },
      data: {
        enabled,
        actorPersonId: session.person.id,
      },
    });
    await writeAudit(tx, {
      actor: { type: 'person', id: session.person.id },
      action: 'updated',
      entity: {
        type: 'mailbox_poll_cursor',
        id: before.id,
        before: { enabled: before.enabled },
        after: { enabled, mailboxUpn },
      },
      source: 'web',
    });
  });

  revalidatePath('/admin/integrations/mail-intake');
  revalidatePath('/system-status');
  return { ok: true };
}
