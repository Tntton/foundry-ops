'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const RateCardVersionSchema = z
  .object({
    roleCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{1,2}[0-9]{0,2}$/u, 'Up to 2 letters + optional digits, e.g. L2, T3, IO'),
    effectiveFrom: z.coerce.date(),
    costRate: z.coerce.number().min(0).max(10_000),
    billRateLow: z.coerce.number().min(0).max(10_000),
    billRateHigh: z.coerce.number().min(0).max(10_000),
  })
  .refine((v) => v.billRateHigh >= v.billRateLow, {
    message: 'Bill rate high must be ≥ low',
    path: ['billRateHigh'],
  });

export type RateCardState = { status: 'idle' } | { status: 'error'; message: string };

export async function createRateCardVersion(
  _prev: RateCardState,
  formData: FormData,
): Promise<RateCardState> {
  const session = await getSession();
  try {
    requireCapability(session, 'ratecard.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = RateCardVersionSchema.safeParse({
    roleCode: formData.get('roleCode'),
    effectiveFrom: formData.get('effectiveFrom'),
    costRate: formData.get('costRate'),
    billRateLow: formData.get('billRateLow'),
    billRateHigh: formData.get('billRateHigh'),
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const d = parsed.data;

  // Prevent duplicate (roleCode, effectiveFrom) — if you want to change an existing
  // effective-date version, add a newer effectiveFrom instead (versioning by design).
  const existing = await prisma.rateCard.findFirst({
    where: { roleCode: d.roleCode, effectiveFrom: d.effectiveFrom },
  });
  if (existing) {
    return {
      status: 'error',
      message: `A ${d.roleCode} row already exists for ${d.effectiveFrom.toISOString().slice(0, 10)}.`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.rateCard.create({
        data: {
          roleCode: d.roleCode,
          effectiveFrom: d.effectiveFrom,
          costRate: Math.round(d.costRate * 100),
          billRateLow: Math.round(d.billRateLow * 100),
          billRateHigh: Math.round(d.billRateHigh * 100),
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'rate_card',
          id: created.id,
          after: {
            roleCode: created.roleCode,
            effectiveFrom: created.effectiveFrom.toISOString().slice(0, 10),
            costRate: created.costRate,
            billRateLow: created.billRateLow,
            billRateHigh: created.billRateHigh,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[rate-card.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/admin/rate-card');
  redirect('/admin/rate-card');
}
