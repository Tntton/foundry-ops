'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const DealCreate = z.object({
  name: z.string().trim().max(200).optional().or(z.literal('').transform(() => null)),
  stage: z.enum(['lead', 'qualifying', 'proposal', 'negotiation', 'won', 'lost']),
  sector: z.string().trim().max(60).optional().or(z.literal('').transform(() => null)),
  // Second-level classification under sector (e.g. provider →
  // cardiology, telehealth-vertical). Only meaningful when `sector`
  // is set; the schema doesn't enforce that link — the UI does.
  sectorSubtype: z
    .string()
    .trim()
    .max(60)
    .optional()
    .or(z.literal('').transform(() => null)),
  clientType: z.string().trim().max(60).optional().or(z.literal('').transform(() => null)),
  engagementType: z
    .string()
    .trim()
    .max(60)
    .optional()
    .or(z.literal('').transform(() => null)),
  // Both fields are optional at deal-creation time — early-stage leads
  // often don't have a sized scope yet. Empty / blank inputs coerce to 0
  // so the UI shows "—" / 0% until the partner fills them in later via
  // the deal detail page. The schema still rejects nonsense like negative
  // numbers and absurd magnitudes.
  expectedValueDollars: z
    .union([z.literal(''), z.coerce.number().min(0).max(100_000_000)])
    .optional()
    .transform((v) => (v === '' || v === undefined ? 0 : v)),
  probability: z
    .union([z.literal(''), z.coerce.number().int().min(0).max(100)])
    .optional()
    .transform((v) => (v === '' || v === undefined ? 0 : v)),
  ownerId: z.string().min(1),
  // Optional co-lead / secondary relationship holder. Empty string
  // coerces to null so the form's "— None —" option flows through.
  secondaryOwnerId: z
    .string()
    .trim()
    .optional()
    .or(z.literal('').transform(() => null))
    .nullable(),
  clientId: z.string().optional().nullable(),
  prospectiveName: z.string().trim().max(200).optional().nullable(),
  prospectiveProjectDetail: z.string().trim().max(4000).optional().nullable(),
  firstConversationAt: z.string().trim().optional().nullable(),
  lastConversationAt: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  contactName: z.string().trim().max(200).optional().nullable(),
  contactRole: z.string().trim().max(200).optional().nullable(),
  contactEmail: z.string().trim().max(200).optional().nullable(),
  contactPhone: z.string().trim().max(40).optional().nullable(),
});

export type NewDealState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

async function generateDealCode(): Promise<string> {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  const d = String(today.getUTCDate()).padStart(2, '0');
  const prefix = `BD-${y}${m}${d}`;
  const same = await prisma.deal.count({ where: { code: { startsWith: prefix } } });
  return `${prefix}-${String(same + 1).padStart(2, '0')}`;
}

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
    name: formData.get('name') || null,
    stage: formData.get('stage') ?? 'lead',
    sector: formData.get('sector') || null,
    sectorSubtype: formData.get('sectorSubtype') || null,
    clientType: formData.get('clientType') || null,
    engagementType: formData.get('engagementType') || null,
    expectedValueDollars: formData.get('expectedValueDollars'),
    probability: formData.get('probability'),
    ownerId: formData.get('ownerId'),
    secondaryOwnerId: formData.get('secondaryOwnerId') || null,
    clientId: formData.get('clientId') || null,
    prospectiveName: formData.get('prospectiveName') || null,
    prospectiveProjectDetail: formData.get('prospectiveProjectDetail') || null,
    firstConversationAt: formData.get('firstConversationAt') || null,
    lastConversationAt: formData.get('lastConversationAt') || null,
    notes: formData.get('notes') || null,
    contactName: formData.get('contactName') || null,
    contactRole: formData.get('contactRole') || null,
    contactEmail: formData.get('contactEmail') || null,
    contactPhone: formData.get('contactPhone') || null,
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
      message: 'Pick an existing client or type the prospective organisation name.',
      fieldErrors: { clientId: 'Required (or prospective name)' },
    };
  }

  const expectedValue = Math.round(data.expectedValueDollars * 100);
  const firstConvAt = data.firstConversationAt
    ? (() => {
        const d = new Date(data.firstConversationAt!);
        return Number.isNaN(d.getTime()) ? null : d;
      })()
    : null;
  const lastConvAt = data.lastConversationAt
    ? (() => {
        const d = new Date(data.lastConversationAt!);
        return Number.isNaN(d.getTime()) ? null : d;
      })()
    : null;

  const code = await generateDealCode();

  let newId: string;
  try {
    newId = await prisma.$transaction(async (tx) => {
      const deal = await tx.deal.create({
        data: {
          code,
          name: data.name ?? null,
          stage: data.stage,
          sector: data.sector ?? null,
          sectorSubtype: data.sectorSubtype ?? null,
          clientType: data.clientType ?? null,
          engagementType: data.engagementType ?? null,
          expectedValue,
          probability: data.probability,
          ownerId: data.ownerId,
          secondaryOwnerId: data.secondaryOwnerId ?? null,
          firstConversationAt: firstConvAt,
          lastConversationAt: lastConvAt,
          ...(data.clientId ? { clientId: data.clientId } : {}),
          ...(data.prospectiveName && !data.clientId
            ? { prospectiveName: data.prospectiveName }
            : {}),
          ...(data.prospectiveProjectDetail
            ? { prospectiveProjectDetail: data.prospectiveProjectDetail }
            : {}),
          ...(data.notes ? { notes: data.notes } : {}),
        },
      });
      if (data.contactName) {
        await tx.dealContact.create({
          data: {
            dealId: deal.id,
            name: data.contactName,
            role: data.contactRole ?? null,
            email: data.contactEmail ?? null,
            phone: data.contactPhone ?? null,
          },
        });
      }
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
            sector: deal.sector,
            clientType: deal.clientType,
            engagementType: deal.engagementType,
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

// Note: `'use server'` files in Next 14 may only export async functions.
// A previous version of this file re-exported a Zod schema for ostensible
// "backwards compat", which raised an "invalid-use-server-value" build
// error (digest 1952080106) the first time the bd/new POST hit. Schemas
// live inline now and don't get re-exported.
