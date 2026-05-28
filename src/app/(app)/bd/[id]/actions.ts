'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

export type DealUpdateState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

const StageSchema = z.object({
  stage: z.enum(['lead', 'qualifying', 'proposal', 'negotiation', 'won', 'lost']),
});

export async function updateDealStage(
  dealId: string,
  _prev: DealUpdateState,
  formData: FormData,
): Promise<DealUpdateState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = StageSchema.safeParse({ stage: formData.get('stage') });
  if (!parsed.success) return { status: 'error', message: 'Invalid stage' };

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return { status: 'error', message: 'Deal not found' };
  if (deal.stage === parsed.data.stage) {
    return { status: 'success', message: 'No change.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id: dealId },
        data: { stage: parsed.data.stage },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'stage_changed',
        entity: {
          type: 'deal',
          id: dealId,
          before: { stage: deal.stage },
          after: { stage: parsed.data.stage },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[deal.stage] failed:', err);
    return { status: 'error', message: 'Update failed — try again.' };
  }

  revalidatePath('/bd');
  revalidatePath(`/bd/${dealId}`);
  return { status: 'success', message: `Moved to ${parsed.data.stage}.` };
}

export async function archiveDeal(
  dealId: string,
  _prev: DealUpdateState,
): Promise<DealUpdateState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return { status: 'error', message: 'Deal not found' };
  if (deal.archivedAt) return { status: 'success', message: 'Already archived.' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id: dealId },
        data: { archivedAt: new Date() },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'archived',
        entity: { type: 'deal', id: dealId, before: { archivedAt: null }, after: { archivedAt: 'now' } },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[deal.archive] failed:', err);
    return { status: 'error', message: 'Archive failed.' };
  }

  revalidatePath('/bd');
  revalidatePath(`/bd/${dealId}`);
  return { status: 'success', message: 'Deal archived.' };
}

export async function unarchiveDeal(
  dealId: string,
  _prev: DealUpdateState,
): Promise<DealUpdateState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return { status: 'error', message: 'Deal not found' };
  if (!deal.archivedAt) return { status: 'success', message: 'Not archived.' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id: dealId },
        data: { archivedAt: null },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'unarchived',
        entity: { type: 'deal', id: dealId, before: { archivedAt: 'set' }, after: { archivedAt: null } },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[deal.unarchive] failed:', err);
    return { status: 'error', message: 'Unarchive failed.' };
  }

  revalidatePath('/bd');
  revalidatePath(`/bd/${dealId}`);
  return { status: 'success', message: 'Deal restored.' };
}

export async function deleteDeal(
  dealId: string,
  _prev: DealUpdateState,
): Promise<DealUpdateState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not authorized' };
  // Deletion is strict: only super_admin may hard-delete (audit trail preserved).
  if (!session.person.roles.includes('super_admin')) {
    return { status: 'error', message: 'Only super-admins can permanently delete deals.' };
  }

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return { status: 'error', message: 'Deal not found' };
  if (deal.convertedProjectId) {
    return {
      status: 'error',
      message: 'This deal is linked to a project — archive it instead.',
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'deleted',
        entity: {
          type: 'deal',
          id: dealId,
          before: {
            code: deal.code,
            name: deal.name,
            stage: deal.stage,
            expectedValue: deal.expectedValue,
          },
        },
        source: 'web',
      });
      await tx.deal.delete({ where: { id: dealId } });
    });
  } catch (err) {
    console.error('[deal.delete] failed:', err);
    return { status: 'error', message: 'Delete failed.' };
  }

  revalidatePath('/bd');
  return { status: 'success', message: 'Deal permanently deleted.' };
}

const DatesSchema = z.object({
  firstConversationAt: z.string().trim().optional().or(z.literal('').transform(() => null)),
  lastConversationAt: z.string().trim().optional().or(z.literal('').transform(() => null)),
});

export async function updateDealConversationDates(
  dealId: string,
  _prev: DealUpdateState,
  formData: FormData,
): Promise<DealUpdateState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = DatesSchema.safeParse({
    firstConversationAt: formData.get('firstConversationAt') || null,
    lastConversationAt: formData.get('lastConversationAt') || null,
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid dates' };

  const first = parsed.data.firstConversationAt
    ? new Date(parsed.data.firstConversationAt)
    : null;
  const last = parsed.data.lastConversationAt
    ? new Date(parsed.data.lastConversationAt)
    : null;

  try {
    await prisma.deal.update({
      where: { id: dealId },
      data: {
        firstConversationAt: first && !Number.isNaN(first.getTime()) ? first : null,
        lastConversationAt: last && !Number.isNaN(last.getTime()) ? last : null,
      },
    });
  } catch (err) {
    console.error('[deal.conv] failed:', err);
    return { status: 'error', message: 'Save failed.' };
  }

  revalidatePath(`/bd/${dealId}`);
  return { status: 'success', message: 'Conversation dates saved.' };
}

const AddContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().max(200).optional().or(z.literal('').transform(() => null)),
  email: z.string().trim().max(200).optional().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(40).optional().or(z.literal('').transform(() => null)),
  notes: z.string().trim().max(1000).optional().or(z.literal('').transform(() => null)),
});

export async function addDealContact(
  dealId: string,
  _prev: DealUpdateState,
  formData: FormData,
): Promise<DealUpdateState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = AddContactSchema.safeParse({
    name: formData.get('name'),
    role: formData.get('role') || null,
    email: formData.get('email') || null,
    phone: formData.get('phone') || null,
    notes: formData.get('notes') || null,
  });
  if (!parsed.success) return { status: 'error', message: 'Name is required' };

  try {
    await prisma.dealContact.create({
      data: {
        dealId,
        name: parsed.data.name,
        role: parsed.data.role,
        email: parsed.data.email,
        phone: parsed.data.phone,
        notes: parsed.data.notes,
      },
    });
  } catch (err) {
    console.error('[deal.addContact] failed:', err);
    return { status: 'error', message: 'Save failed.' };
  }

  revalidatePath(`/bd/${dealId}`);
  return { status: 'success', message: 'Contact added.' };
}

export async function deleteDealContact(
  dealId: string,
  contactId: string,
  _prev: DealUpdateState,
): Promise<DealUpdateState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  try {
    await prisma.dealContact.delete({ where: { id: contactId } });
  } catch (err) {
    console.error('[deal.deleteContact] failed:', err);
    return { status: 'error', message: 'Delete failed.' };
  }

  revalidatePath(`/bd/${dealId}`);
  return { status: 'success', message: 'Contact removed.' };
}

const NotesSchema = z.object({
  notes: z.string().trim().max(4000),
});

export async function updateDealNotes(
  dealId: string,
  _prev: DealUpdateState,
  formData: FormData,
): Promise<DealUpdateState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = NotesSchema.safeParse({ notes: formData.get('notes') ?? '' });
  if (!parsed.success) return { status: 'error', message: 'Invalid notes' };

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return { status: 'error', message: 'Deal not found' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id: dealId },
        data: { notes: parsed.data.notes || null },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'notes_updated',
        entity: {
          type: 'deal',
          id: dealId,
          before: { notes: deal.notes ? '(previous)' : null },
          after: { notes: parsed.data.notes ? '(updated)' : null },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[deal.notes] failed:', err);
    return { status: 'error', message: 'Update failed.' };
  }

  revalidatePath(`/bd/${dealId}`);
  return { status: 'success', message: 'Notes saved.' };
}

// ─── Comprehensive deal-fields edit ────────────────────────────────────
//
// Single endpoint that updates every editable key field on the Deal —
// avoids the explosion of one-action-per-column we'd otherwise need
// (name, owner, value, probability, sector, type, engagement, target
// close, prospective project detail, client/prospective swap). Every
// field is independently optional, so partners can save partial edits
// without hitting required-field gates. Stage stays on its own action
// because its lifecycle (won → convert-to-project) is special.

const FieldsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .max(200)
      .optional()
      .or(z.literal('').transform(() => null)),
    sector: z
      .string()
      .trim()
      .max(60)
      .optional()
      .or(z.literal('').transform(() => null)),
    clientType: z
      .string()
      .trim()
      .max(60)
      .optional()
      .or(z.literal('').transform(() => null)),
    engagementType: z
      .string()
      .trim()
      .max(60)
      .optional()
      .or(z.literal('').transform(() => null)),
    expectedValueDollars: z
      .union([z.literal(''), z.coerce.number().min(0).max(100_000_000)])
      .optional()
      .transform((v) => (v === '' || v === undefined ? 0 : v)),
    probability: z
      .union([z.literal(''), z.coerce.number().int().min(0).max(100)])
      .optional()
      .transform((v) => (v === '' || v === undefined ? 0 : v)),
    ownerId: z.string().min(1, 'Pick an owner'),
    clientId: z
      .string()
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
    prospectiveName: z
      .string()
      .trim()
      .max(200)
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
    prospectiveProjectDetail: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
    targetCloseDate: z
      .union([z.literal(''), z.coerce.date()])
      .optional()
      .transform((v) =>
        v === '' || v === undefined || !(v instanceof Date) ? null : v,
      ),
  })
  .refine(
    (v) => Boolean(v.clientId) || Boolean(v.prospectiveName),
    {
      message: 'Either pick a client or type a prospective name.',
      path: ['clientId'],
    },
  );

export async function updateDealFields(
  dealId: string,
  _prev: DealUpdateState,
  formData: FormData,
): Promise<DealUpdateState> {
  const session = await getSession();
  try {
    requireCapability(session, 'deal.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = FieldsSchema.safeParse({
    name: formData.get('name'),
    sector: formData.get('sector'),
    clientType: formData.get('clientType'),
    engagementType: formData.get('engagementType'),
    expectedValueDollars: formData.get('expectedValueDollars'),
    probability: formData.get('probability'),
    ownerId: formData.get('ownerId'),
    clientId: formData.get('clientId'),
    prospectiveName: formData.get('prospectiveName'),
    prospectiveProjectDetail: formData.get('prospectiveProjectDetail'),
    targetCloseDate: formData.get('targetCloseDate'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  const existing = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!existing) return { status: 'error', message: 'Deal not found' };
  if (existing.archivedAt) {
    return { status: 'error', message: 'Archived deals are read-only.' };
  }

  // If the partner picks a real client, drop any stale prospective name
  // — we don't want both columns populated, the model treats clientId as
  // the source of truth when set.
  const finalClientId = data.clientId || null;
  const finalProspectiveName = finalClientId ? null : data.prospectiveName;

  const expectedValue = Math.round(data.expectedValueDollars * 100);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id: dealId },
        data: {
          name: data.name ?? null,
          sector: data.sector ?? null,
          clientType: data.clientType ?? null,
          engagementType: data.engagementType ?? null,
          expectedValue,
          probability: data.probability,
          ownerId: data.ownerId,
          clientId: finalClientId,
          prospectiveName: finalProspectiveName,
          prospectiveProjectDetail: data.prospectiveProjectDetail ?? null,
          targetCloseDate: data.targetCloseDate,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'updated',
        entity: {
          type: 'deal',
          id: dealId,
          before: {
            name: existing.name,
            sector: existing.sector,
            clientType: existing.clientType,
            engagementType: existing.engagementType,
            expectedValue: existing.expectedValue,
            probability: existing.probability,
            ownerId: existing.ownerId,
            clientId: existing.clientId,
            prospectiveName: existing.prospectiveName,
            prospectiveProjectDetail: existing.prospectiveProjectDetail,
            targetCloseDate: existing.targetCloseDate?.toISOString() ?? null,
          },
          after: {
            name: data.name ?? null,
            sector: data.sector ?? null,
            clientType: data.clientType ?? null,
            engagementType: data.engagementType ?? null,
            expectedValue,
            probability: data.probability,
            ownerId: data.ownerId,
            clientId: finalClientId,
            prospectiveName: finalProspectiveName,
            prospectiveProjectDetail: data.prospectiveProjectDetail ?? null,
            targetCloseDate: data.targetCloseDate?.toISOString() ?? null,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[deal.updateFields] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/bd');
  revalidatePath(`/bd/${dealId}`);
  return { status: 'success', message: 'Deal saved.' };
}
