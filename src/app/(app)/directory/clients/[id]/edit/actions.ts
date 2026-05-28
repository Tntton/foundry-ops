'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { resolveCompanyAssets } from '@/server/integrations/company-logo';

const PAYMENT_TERMS = ['net-14', 'net-30', 'net-45', 'net-60'] as const;
const CLIENT_TYPES = [
  'private_company',
  'public_company',
  'government',
  'not_for_profit',
  'partnership',
  'sole_trader',
  'individual',
] as const;
const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;

/**
 * Edit-client schema. Most fields are optional because legacy seed rows
 * have only a subset filled in — we don't want the form to error out
 * just because nobody added a postcode yet. Strings are trimmed and empty
 * strings normalize to null so blank inputs save as NULL not "".
 */
const ClientEdit = z.object({
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
  acn: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s/g, ''))
    .refine((s) => s === '' || /^[0-9]{9}$/.test(s), '9-digit ACN')
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v)),
  clientType: z.enum(CLIENT_TYPES),
  streetAddress: z.string().trim().max(200).optional().nullable(),
  suburb: z.string().trim().max(80).optional().nullable(),
  state: z
    .string()
    .trim()
    .transform((s) => (s === '' ? null : s.toUpperCase()))
    .nullable()
    .refine(
      (s) => s === null || (AU_STATES as readonly string[]).includes(s),
      'Use AU state code',
    ),
  postcode: z
    .string()
    .trim()
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .refine(
      (s) => s === null || /^[0-9]{4}$/.test(s),
      'Postcode must be 4 digits',
    ),
  country: z.string().trim().max(40).default('AU'),
  billingEmail: z
    .string()
    .trim()
    .email()
    .max(254)
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  contactName: z.string().trim().max(120).optional().nullable(),
  contactTitle: z.string().trim().max(120).optional().nullable(),
  contactEmail: z
    .string()
    .trim()
    .email()
    .max(254)
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  contactPhone: z.string().trim().max(40).optional().nullable(),
  website: z
    .string()
    .trim()
    .max(300)
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  paymentTerms: z.enum(PAYMENT_TERMS),
  purchaseOrderRequired: z
    .union([z.literal('1'), z.literal('on'), z.null(), z.undefined()])
    .transform((v) => v === '1' || v === 'on'),
  paymentInstructions: z.string().trim().max(2000).optional().nullable(),
  primaryPartnerId: z.string().min(1, 'Primary partner is required'),
});

export type ClientEditState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

function clean(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

export async function updateClient(
  clientId: string,
  _prev: ClientEditState,
  formData: FormData,
): Promise<ClientEditState> {
  const session = await getSession();
  try {
    requireCapability(session, 'client.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const raw = {
    legalName: formData.get('legalName'),
    tradingName: clean(formData.get('tradingName')),
    abn: clean(formData.get('abn')) ?? '',
    acn: clean(formData.get('acn')) ?? '',
    clientType: formData.get('clientType') ?? 'private_company',
    streetAddress: clean(formData.get('streetAddress')),
    suburb: clean(formData.get('suburb')),
    state: formData.get('state') ?? '',
    postcode: formData.get('postcode') ?? '',
    country: clean(formData.get('country')) ?? 'AU',
    billingEmail: clean(formData.get('billingEmail')) ?? '',
    contactName: clean(formData.get('contactName')),
    contactTitle: clean(formData.get('contactTitle')),
    contactEmail: clean(formData.get('contactEmail')) ?? '',
    contactPhone: clean(formData.get('contactPhone')),
    website: clean(formData.get('website')),
    paymentTerms: formData.get('paymentTerms') ?? 'net-30',
    purchaseOrderRequired: formData.get('purchaseOrderRequired'),
    paymentInstructions: clean(formData.get('paymentInstructions')),
    primaryPartnerId: formData.get('primaryPartnerId'),
  };

  const parsed = ClientEdit.safeParse(raw);
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

  const existing = await prisma.client.findUnique({ where: { id: clientId } });
  if (!existing) return { status: 'error', message: 'Client not found' };

  // Resolve website / domain / logoUrl on every save so a stale cached
  // logo picks up the new website. Falls back to billing or contact
  // email when the operator left website blank.
  const assets = resolveCompanyAssets({
    website: data.website,
    email: data.billingEmail ?? data.contactEmail ?? null,
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id: clientId },
        data: {
          legalName: data.legalName,
          tradingName: data.tradingName,
          abn: data.abn,
          acn: data.acn,
          clientType: data.clientType,
          streetAddress: data.streetAddress,
          suburb: data.suburb,
          state: data.state,
          postcode: data.postcode,
          country: data.country,
          billingEmail: data.billingEmail,
          contactName: data.contactName,
          contactTitle: data.contactTitle,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone,
          website: assets.website,
          domain: assets.domain,
          logoUrl: assets.logoUrl,
          paymentTerms: data.paymentTerms,
          purchaseOrderRequired: data.purchaseOrderRequired,
          paymentInstructions: data.paymentInstructions,
          primaryPartnerId: data.primaryPartnerId,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'client',
          id: clientId,
          before: {
            legalName: existing.legalName,
            tradingName: existing.tradingName,
            abn: existing.abn,
            acn: existing.acn,
            clientType: existing.clientType,
            streetAddress: existing.streetAddress,
            suburb: existing.suburb,
            state: existing.state,
            postcode: existing.postcode,
            country: existing.country,
            billingEmail: existing.billingEmail,
            contactName: existing.contactName,
            contactTitle: existing.contactTitle,
            contactEmail: existing.contactEmail,
            contactPhone: existing.contactPhone,
            website: existing.website,
            domain: existing.domain,
            logoUrl: existing.logoUrl,
            paymentTerms: existing.paymentTerms,
            purchaseOrderRequired: existing.purchaseOrderRequired,
            paymentInstructions: existing.paymentInstructions,
            primaryPartnerId: existing.primaryPartnerId,
          },
          after: {
            legalName: data.legalName,
            tradingName: data.tradingName,
            abn: data.abn,
            acn: data.acn,
            clientType: data.clientType,
            streetAddress: data.streetAddress,
            suburb: data.suburb,
            state: data.state,
            postcode: data.postcode,
            country: data.country,
            billingEmail: data.billingEmail,
            contactName: data.contactName,
            contactTitle: data.contactTitle,
            contactEmail: data.contactEmail,
            contactPhone: data.contactPhone,
            website: assets.website,
            domain: assets.domain,
            logoUrl: assets.logoUrl,
            paymentTerms: data.paymentTerms,
            purchaseOrderRequired: data.purchaseOrderRequired,
            paymentInstructions: data.paymentInstructions,
            primaryPartnerId: data.primaryPartnerId,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[client.update] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/directory/clients');
  revalidatePath(`/directory/clients/${clientId}`);
  redirect(`/directory/clients/${clientId}`);
}
