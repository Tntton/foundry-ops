'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { resolveCompanyAssets } from '@/server/integrations/company-logo';

const SUPPLIER_TYPES = [
  'private_company',
  'public_company',
  'government',
  'not_for_profit',
  'partnership',
  'sole_trader',
  'individual',
] as const;

const SupplierProfileSchema = z.object({
  legalName: z.string().trim().max(200).optional().or(z.literal('').transform(() => null)).nullable(),
  abn: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s/g, ''))
    .refine((s) => s === '' || /^[0-9]{11}$/.test(s), '11-digit ABN')
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v)),
  acn: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s/g, ''))
    .refine((s) => s === '' || /^[0-9]{9}$/.test(s), '9-digit ACN')
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v)),
  supplierType: z.enum(SUPPLIER_TYPES).default('private_company'),
  website: z.string().trim().max(300).optional().or(z.literal('').transform(() => null)).nullable(),
  contactEmail: z
    .string()
    .trim()
    .email()
    .max(254)
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  contactPhone: z.string().trim().max(40).optional().or(z.literal('').transform(() => null)).nullable(),
});

export type SupplierProfileState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> }
  | { status: 'success' };

function clean(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Upsert (by unique `name`) the structured profile for an external
 * supplier — website, ABN, contact details. Resolves the logo from
 * the website (or contact email) on every save so the cached URL
 * stays in sync.
 *
 * Authorised for super_admin / admin / partner — same gate as the
 * supplier directory itself.
 */
export async function upsertSupplierProfile(
  name: string,
  _prev: SupplierProfileState,
  formData: FormData,
): Promise<SupplierProfileState> {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) {
    return { status: 'error', message: 'Not authorized' };
  }

  const raw = {
    legalName: clean(formData.get('legalName')),
    abn: clean(formData.get('abn')) ?? '',
    acn: clean(formData.get('acn')) ?? '',
    supplierType: formData.get('supplierType') ?? 'private_company',
    website: clean(formData.get('website')),
    contactEmail: clean(formData.get('contactEmail')) ?? '',
    contactPhone: clean(formData.get('contactPhone')),
  };

  const parsed = SupplierProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors,
    };
  }
  const data = parsed.data;
  const assets = resolveCompanyAssets({
    website: data.website,
    email: data.contactEmail ?? null,
  });

  const existing = await prisma.supplier.findUnique({ where: { name } });

  try {
    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.supplier.update({
          where: { id: existing.id },
          data: {
            legalName: data.legalName,
            abn: data.abn,
            acn: data.acn,
            supplierType: data.supplierType,
            website: assets.website,
            domain: assets.domain,
            logoUrl: assets.logoUrl,
            contactEmail: data.contactEmail,
            contactPhone: data.contactPhone,
          },
        });
      } else {
        await tx.supplier.create({
          data: {
            name,
            legalName: data.legalName,
            abn: data.abn,
            acn: data.acn,
            supplierType: data.supplierType,
            website: assets.website,
            domain: assets.domain,
            logoUrl: assets.logoUrl,
            contactEmail: data.contactEmail,
            contactPhone: data.contactPhone,
          },
        });
      }
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: existing ? 'updated' : 'created',
        entity: {
          type: 'supplier',
          id: existing?.id ?? name,
          before: existing
            ? {
                legalName: existing.legalName,
                abn: existing.abn,
                acn: existing.acn,
                supplierType: existing.supplierType,
                website: existing.website,
                domain: existing.domain,
                logoUrl: existing.logoUrl,
                contactEmail: existing.contactEmail,
                contactPhone: existing.contactPhone,
              }
            : null,
          after: {
            name,
            legalName: data.legalName,
            abn: data.abn,
            acn: data.acn,
            supplierType: data.supplierType,
            website: assets.website,
            domain: assets.domain,
            logoUrl: assets.logoUrl,
            contactEmail: data.contactEmail,
            contactPhone: data.contactPhone,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[supplier.upsert] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/directory/suppliers');
  revalidatePath(`/directory/suppliers/${encodeURIComponent(name)}`);
  return { status: 'success' };
}
