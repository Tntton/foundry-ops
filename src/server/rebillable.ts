'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';

export type RebillableState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; rebillable: boolean };

const Schema = z.object({
  kind: z.enum(['bill', 'expense']),
  id: z.string().min(1),
  rebillable: z.union([z.literal('1'), z.literal('0')]),
});

/**
 * Flip the rebillable flag on a Bill or Expense. The flag tells the
 * draft-invoice flow to suggest this cost as a line item on the next
 * client invoice for the project. Locked once the cost has already been
 * forwarded (rebilledOnInvoiceId is set) — a cost can only be billed to
 * the client once.
 *
 * Authorization: super_admin / admin / partner / manager. Staff can
 * submit expenses but don't decide what's recharged to the client.
 */
export async function toggleRebillable(
  _prev: RebillableState,
  formData: FormData,
): Promise<RebillableState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner', 'manager'])) {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = Schema.safeParse({
    kind: formData.get('kind'),
    id: formData.get('id'),
    rebillable: formData.get('rebillable'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { kind, id, rebillable } = parsed.data;
  const next = rebillable === '1';

  try {
    await prisma.$transaction(async (tx) => {
      if (kind === 'bill') {
        const existing = await tx.bill.findUnique({
          where: { id },
          select: { id: true, rebillable: true, rebilledOnInvoiceId: true, projectId: true },
        });
        if (!existing) throw new Error('Bill not found');
        if (existing.rebilledOnInvoiceId) {
          throw new Error('Already forwarded to a client invoice — flag locked.');
        }
        if (next && !existing.projectId) {
          throw new Error('Tag a project first — only project costs can be rebilled.');
        }
        await tx.bill.update({
          where: { id },
          data: { rebillable: next },
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'updated',
          entity: {
            type: 'bill',
            id,
            before: { rebillable: existing.rebillable },
            after: { rebillable: next, via: 'rebillable_toggle' },
          },
          source: 'web',
        });
      } else {
        const existing = await tx.expense.findUnique({
          where: { id },
          select: { id: true, rebillable: true, rebilledOnInvoiceId: true, projectId: true },
        });
        if (!existing) throw new Error('Expense not found');
        if (existing.rebilledOnInvoiceId) {
          throw new Error('Already forwarded to a client invoice — flag locked.');
        }
        if (next && !existing.projectId) {
          throw new Error('Tag a project first — only project costs can be rebilled.');
        }
        await tx.expense.update({
          where: { id },
          data: { rebillable: next },
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'updated',
          entity: {
            type: 'expense',
            id,
            before: { rebillable: existing.rebillable },
            after: { rebillable: next, via: 'rebillable_toggle' },
          },
          source: 'web',
        });
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed';
    return { status: 'error', message };
  }

  revalidatePath('/payables');
  revalidatePath('/reimbursables');
  return { status: 'success', rebillable: next };
}
