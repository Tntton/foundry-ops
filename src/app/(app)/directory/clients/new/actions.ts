'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const PAYMENT_TERMS = ['net-14', 'net-30', 'net-45'] as const;

const ClientCreate = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(10)
    .regex(/^[A-Z][A-Z0-9]+$/u, 'Uppercase letters/digits only, starting with a letter'),
  legalName: z.string().trim().min(2).max(200),
  tradingName: z.string().trim().max(200).optional().nullable(),
  abn: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s/g, ''))
    .refine((s) => s === '' || /^[0-9]{11}$/.test(s), '11-digit ABN')
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v)),
  billingAddress: z.string().trim().max(500).optional().nullable(),
  billingEmail: z.string().trim().email().max(254).optional().nullable(),
  primaryPartnerId: z.string().min(1, 'Primary partner is required'),
  paymentTerms: z.enum(PAYMENT_TERMS),
});

export type NewClientState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function createClient(
  _prev: NewClientState,
  formData: FormData,
): Promise<NewClientState> {
  const session = await getSession();
  try {
    requireCapability(session, 'client.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const raw = {
    code: String(formData.get('code') ?? '').toUpperCase(),
    legalName: formData.get('legalName'),
    tradingName: formData.get('tradingName') || null,
    abn: formData.get('abn') || null,
    billingAddress: formData.get('billingAddress') || null,
    billingEmail: formData.get('billingEmail') || null,
    primaryPartnerId: formData.get('primaryPartnerId'),
    paymentTerms: formData.get('paymentTerms') || 'net-30',
  };

  const parsed = ClientCreate.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }

  const data = parsed.data;

  const existingCode = await prisma.client.findUnique({ where: { code: data.code } });
  if (existingCode) {
    return {
      status: 'error',
      message: 'Code already in use.',
      fieldErrors: { code: 'Already used by another client' },
    };
  }

  let newId: string;
  try {
    newId = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          code: data.code,
          legalName: data.legalName,
          tradingName: data.tradingName,
          abn: data.abn,
          billingAddress: data.billingAddress,
          billingEmail: data.billingEmail,
          primaryPartnerId: data.primaryPartnerId,
          paymentTerms: data.paymentTerms,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'client',
          id: client.id,
          after: {
            code: client.code,
            legalName: client.legalName,
            tradingName: client.tradingName,
            abn: client.abn,
            primaryPartnerId: client.primaryPartnerId,
            paymentTerms: client.paymentTerms,
          },
        },
        source: 'web',
      });
      return client.id;
    });
  } catch (err) {
    console.error('[client.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/directory/clients');
  redirect(`/directory/clients/${newId}`);
}
