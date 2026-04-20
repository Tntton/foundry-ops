'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const UpsertSchema = z.object({
  id: z.string().optional().nullable(),
  subjectType: z.enum(['invoice', 'expense', 'bill', 'pay_run', 'contract', 'new_hire', 'rate_change']),
  comparator: z.enum(['gt', 'gte', 'lte', 'lt', 'any']),
  thresholdDollars: z.union([z.coerce.number().min(0).max(100_000_000), z.literal('')]).optional(),
  requiredRole: z.enum(['super_admin', 'admin', 'partner', 'manager', 'staff']),
  requireMfa: z.union([z.literal('on'), z.literal('off'), z.literal('')]).optional(),
  active: z.union([z.literal('on'), z.literal('off'), z.literal('')]).optional(),
});

export type PolicyState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

export async function upsertPolicy(
  _prev: PolicyState,
  formData: FormData,
): Promise<PolicyState> {
  const session = await getSession();
  try {
    requireCapability(session, 'approval.policy.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = UpsertSchema.safeParse({
    id: formData.get('id') || null,
    subjectType: formData.get('subjectType'),
    comparator: formData.get('comparator'),
    thresholdDollars: formData.get('thresholdDollars'),
    requiredRole: formData.get('requiredRole'),
    requireMfa: formData.get('requireMfa') || '',
    active: formData.get('active') || 'on',
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid policy payload' };
  }
  const data = parsed.data;

  if (data.comparator !== 'any') {
    if (data.thresholdDollars === '' || data.thresholdDollars === undefined) {
      return { status: 'error', message: 'Threshold is required for this comparator' };
    }
  }

  const thresholdCents =
    data.comparator === 'any' ||
    data.thresholdDollars === '' ||
    data.thresholdDollars === undefined
      ? null
      : Math.round(Number(data.thresholdDollars) * 100);

  const nextValues = {
    subjectType: data.subjectType,
    comparator: data.comparator,
    thresholdCents,
    requiredRole: data.requiredRole,
    requireMfa: data.requireMfa === 'on',
    active: data.active !== 'off',
    channel: 'any',
  };

  try {
    if (data.id) {
      const existing = await prisma.approvalPolicy.findUnique({ where: { id: data.id } });
      if (!existing) return { status: 'error', message: 'Policy not found' };
      await prisma.$transaction(async (tx) => {
        const updated = await tx.approvalPolicy.update({
          where: { id: data.id! },
          data: nextValues,
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'updated',
          entity: {
            type: 'approval_policy',
            id: updated.id,
            before: {
              subjectType: existing.subjectType,
              comparator: existing.comparator,
              thresholdCents: existing.thresholdCents,
              requiredRole: existing.requiredRole,
              requireMfa: existing.requireMfa,
              active: existing.active,
            },
            after: nextValues,
          },
          source: 'web',
        });
      });
    } else {
      await prisma.$transaction(async (tx) => {
        const created = await tx.approvalPolicy.create({ data: nextValues });
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'created',
          entity: { type: 'approval_policy', id: created.id, after: nextValues },
          source: 'web',
        });
      });
    }
  } catch (err) {
    console.error('[approval-policies.upsert] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/admin/approval-policies');
  return { status: 'success', message: 'Policy saved.' };
}
