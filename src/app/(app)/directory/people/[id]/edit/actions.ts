'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

import { isKnownCountryCode } from '@/lib/countries';
import { resolveCompanyAssets } from '@/server/integrations/company-logo';

const PersonEdit = z
  .object({
    firstName: z.string().trim().min(1, 'Required').max(120),
    lastName: z.string().trim().min(1, 'Required').max(120),
    phone: z.string().trim().max(40).optional().nullable(),
    whatsappNumber: z
      .string()
      .trim()
      .regex(/^\+?[0-9\s-]*$/u, 'Digits, spaces, + and - only')
      .max(40)
      .optional()
      .nullable(),
    band: z.enum(['MP', 'Partner', 'Associate_Partner', 'Expert', 'Consultant', 'Analyst']),
    level: z.string().trim().min(1).max(10),
    employment: z.enum(['ft', 'contractor']),
    // FTE only meaningful for full-time non-partners; contractors + partners
    // are tracked without a specific allocation.
    fte: z
      .union([z.coerce.number().min(0.1).max(1.0), z.literal('').transform(() => null)])
      .optional()
      .nullable(),
    region: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => /^[A-Z]{2}$/.test(c), 'Invalid country code')
      .refine(isKnownCountryCode, 'Unsupported country'),
    mailingAddress: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal('').transform(() => null)),
    rateUnit: z.enum(['hour', 'day']),
    rateDollars: z.coerce.number().min(0).max(10_000),
    // Contractor's company website (their consulting business). The
    // logo is auto-resolved from this; staff/partners typically leave
    // it blank.
    website: z
      .string()
      .trim()
      .max(300)
      .optional()
      .or(z.literal('').transform(() => null))
      .nullable(),
    roles: z
      .array(z.enum(['super_admin', 'admin', 'partner', 'manager', 'staff']))
      .min(1, 'At least one role required'),
  });

export type PersonEditActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> }
  | { status: 'success' };

export async function updatePerson(
  id: string,
  _prev: PersonEditActionState,
  formData: FormData,
): Promise<PersonEditActionState> {
  const session = await getSession();
  try {
    requireCapability(session, 'person.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const fteRaw = formData.get('fte');
  const raw = {
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    phone: formData.get('phone') || null,
    whatsappNumber: formData.get('whatsappNumber') || null,
    band: formData.get('band'),
    level: formData.get('level'),
    employment: formData.get('employment'),
    fte: typeof fteRaw === 'string' && fteRaw.trim() !== '' ? fteRaw : '',
    region: formData.get('region'),
    mailingAddress: formData.get('mailingAddress') || null,
    rateUnit: formData.get('rateUnit'),
    rateDollars: formData.get('rateDollars'),
    website: formData.get('website') || null,
    roles: formData.getAll('roles'),
  };

  const parsed = PersonEdit.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }

  const existing = await prisma.person.findUnique({ where: { id } });
  if (!existing) return { status: 'error', message: 'Person not found' };

  const data = parsed.data;
  const nextRate = Math.round(data.rateDollars * 100);
  // Leadership (Partner / MP / AP) + contractors don't need an FTE
  // number — their capacity is variable / per-project.
  const fteToStore =
    data.employment === 'contractor' ||
    data.band === 'Partner' ||
    data.band === 'MP' ||
    data.band === 'Associate_Partner'
      ? null
      : typeof data.fte === 'number'
        ? data.fte
        : null;

  // Compute the 'before' and 'after' for the audit diff — only the fields we
  // actually manage here.
  // Resolve company assets — only meaningful for contractors. For
  // staff/partners we still call the helper so an admin can blank a
  // mistakenly-stored website.
  const companyAssets = resolveCompanyAssets({
    website: data.website ?? null,
    email: existing.email,
  });
  const before = {
    firstName: existing.firstName,
    lastName: existing.lastName,
    phone: existing.phone,
    whatsappNumber: existing.whatsappNumber,
    band: existing.band,
    level: existing.level,
    employment: existing.employment,
    fte: existing.fte !== null ? Number(existing.fte) : null,
    region: existing.region,
    mailingAddress: existing.mailingAddress,
    rateUnit: existing.rateUnit,
    rate: existing.rate,
    website: existing.website,
    domain: existing.domain,
    logoUrl: existing.logoUrl,
    roles: existing.roles,
  };
  const after = {
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phone ?? null,
    whatsappNumber: data.whatsappNumber ?? null,
    band: data.band,
    level: data.level,
    employment: data.employment,
    fte: fteToStore,
    region: data.region,
    mailingAddress: data.mailingAddress ?? null,
    rateUnit: data.rateUnit,
    rate: nextRate,
    website: companyAssets.website,
    domain: companyAssets.domain,
    logoUrl: companyAssets.logoUrl,
    roles: data.roles,
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id },
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          whatsappNumber: data.whatsappNumber,
          band: data.band,
          level: data.level,
          employment: data.employment,
          fte: fteToStore,
          region: data.region,
          mailingAddress: data.mailingAddress ?? null,
          rateUnit: data.rateUnit,
          rate: nextRate,
          website: companyAssets.website,
          domain: companyAssets.domain,
          logoUrl: companyAssets.logoUrl,
          roles: data.roles,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'person',
          id,
          before,
          after,
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[person.edit] update failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/directory');
  revalidatePath(`/directory/people/${id}`);
  redirect(`/directory/people/${id}`);
}
