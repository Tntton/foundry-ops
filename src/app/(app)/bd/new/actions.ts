'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const DealCreate = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9-]{2,14}$/u, '3-15 uppercase letters/digits/hyphens, letter first'),
  name: z.string().trim().min(3).max(200),
  stage: z.enum(['lead', 'qualifying', 'proposal', 'negotiation', 'won', 'lost']),
  expectedValueDollars: z.coerce.number().min(0).max(100_000_000),
  probability: z.coerce.number().int().min(0).max(100),
  targetCloseDate: z.string().trim().optional().nullable(),
  ownerId: z.string().min(1),
  clientId: z.string().optional().nullable(),
  prospectiveName: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export type NewDealState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function createDeal(
  _prev: NewDealState,
  formData: FormData,
): Promise<NewDealState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const raw = {
    code: String(formData.get('code') ?? '').toUpperCase(),
    name: formData.get('name'),
    stage: formData.get('stage') ?? 'lead',
    expectedValueDollars: formData.get('expectedValueDollars'),
    probability: formData.get('probability'),
    targetCloseDate: formData.get('targetCloseDate') || null,
    ownerId: formData.get('ownerId'),
    clientId: formData.get('clientId') || null,
    prospectiveName: formData.get('prospectiveName') || null,
    notes: formData.get('notes') || null,
  };

  const parsed = DealCreate.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }

  const data = parsed.data;
  if (!data.clientId && !data.prospectiveName) {
    return {
      status: 'error',
      message: 'Either pick an existing client or type the prospective company name.',
      fieldErrors: { clientId: 'Required (or prospective name)' },
    };
  }

  const existingCode = await prisma.deal.findUnique({ where: { code: data.code } });
  if (existingCode) {
    return {
      status: 'error',
      message: 'Code already in use.',
      fieldErrors: { code: 'Already used' },
    };
  }

  const expectedValue = Math.round(data.expectedValueDollars * 100);
  let targetCloseDate: Date | null = null;
  if (data.targetCloseDate) {
    const d = new Date(data.targetCloseDate);
    if (!Number.isNaN(d.getTime())) targetCloseDate = d;
  }

  let newId: string;
  try {
    newId = await prisma.$transaction(async (tx) => {
      const deal = await tx.deal.create({
        data: {
          code: data.code,
          name: data.name,
          stage: data.stage,
          expectedValue,
          probability: data.probability,
          targetCloseDate,
          ownerId: data.ownerId,
          ...(data.clientId ? { clientId: data.clientId } : {}),
          ...(data.prospectiveName && !data.clientId
            ? { prospectiveName: data.prospectiveName }
            : {}),
          ...(data.notes ? { notes: data.notes } : {}),
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'deal',
          id: deal.id,
          after: {
            code: deal.code,
            name: deal.name,
            stage: deal.stage,
            expectedValue: deal.expectedValue,
            probability: deal.probability,
            clientId: deal.clientId,
            prospectiveName: deal.prospectiveName,
          },
        },
        source: 'web',
      });
      return deal.id;
    });
  } catch (err) {
    console.error('[deal.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/bd');
  redirect(`/bd/${newId}`);
}
