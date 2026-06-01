'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const TARGET_BAND_ENUM = z.enum([
  'senior_leader',
  'expert',
  'fellow',
  'manager',
  'consultant',
  'analyst',
]);

const STATUS_ENUM = z.enum(['active', 'nixed', 'converted']);

const NewRecruitSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal('').transform(() => null))
    .nullable(),
  phone: z.string().trim().max(40).optional().or(z.literal('').transform(() => null)).nullable(),
  location: z.string().trim().max(120).optional().or(z.literal('').transform(() => null)).nullable(),
  targetBand: TARGET_BAND_ENUM,
  stage: z.string().trim().max(60).optional().or(z.literal('').transform(() => null)).nullable(),
  source: z.string().trim().max(200).optional().or(z.literal('').transform(() => null)).nullable(),
  referredById: z.string().trim().optional().or(z.literal('').transform(() => null)).nullable(),
  ownerId: z.string().min(1),
  notes: z.string().trim().max(4000).optional().or(z.literal('').transform(() => null)).nullable(),
  linkedinUrl: z.string().trim().url().optional().or(z.literal('').transform(() => null)).nullable(),
  cvSharepointUrl: z.string().trim().url().optional().or(z.literal('').transform(() => null)).nullable(),
});

export type NewRecruitState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function createRecruit(
  _prev: NewRecruitState,
  formData: FormData,
): Promise<NewRecruitState> {
  const session = await getSession();
  try {
    requireCapability(session, 'recruit.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = NewRecruitSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email') ?? null,
    phone: formData.get('phone') ?? null,
    location: formData.get('location') ?? null,
    targetBand: formData.get('targetBand'),
    stage: formData.get('stage') ?? null,
    source: formData.get('source') ?? null,
    referredById: formData.get('referredById') ?? null,
    ownerId: formData.get('ownerId'),
    notes: formData.get('notes') ?? null,
    linkedinUrl: formData.get('linkedinUrl') ?? null,
    cvSharepointUrl: formData.get('cvSharepointUrl') ?? null,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path.join('.');
      if (!fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }

  const data = parsed.data;
  let newId: string;
  try {
    newId = await prisma.$transaction(async (tx) => {
      const recruit = await tx.recruitProspect.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          location: data.location,
          targetBand: data.targetBand,
          stage: data.stage,
          source: data.source,
          referredById: data.referredById || null,
          ownerId: data.ownerId,
          notes: data.notes,
          linkedinUrl: data.linkedinUrl,
          cvSharepointUrl: data.cvSharepointUrl,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'created',
        entity: {
          type: 'recruit_prospect',
          id: recruit.id,
          after: {
            name: `${recruit.firstName} ${recruit.lastName}`,
            targetBand: recruit.targetBand,
            ownerId: recruit.ownerId,
          },
        },
        source: 'web',
      });
      return recruit.id;
    });
  } catch (err) {
    console.error('[recruit.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/talent');
  redirect(`/talent/${newId}`);
}

// ─── Quick-add from a kanban column ──────────────────────────────────

const QuickAddSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  targetBand: TARGET_BAND_ENUM,
});

export type QuickAddState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; recruitId: string };

/**
 * Lightweight create from a kanban-column quick-add input. Captures
 * only the bare minimum (first + last name + the column's band),
 * defaults the rest, and **does NOT redirect** — the admin stays on
 * the board so they can keep adding prospects without bouncing
 * through the detail page. Owner defaults to the logged-in user
 * (= super_admin, by capability gate).
 *
 * Returns the new `recruitId` so the client component can surface
 * an "Open ↗" link to the detail page if the admin wants to fill in
 * source / stage / notes immediately. By default the page just
 * revalidates and the new card appears in the column.
 */
export async function createRecruitQuick(
  _prev: QuickAddState,
  formData: FormData,
): Promise<QuickAddState> {
  const session = await getSession();
  try {
    requireCapability(session, 'recruit.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = QuickAddSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    targetBand: formData.get('targetBand'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid name',
    };
  }
  const { firstName, lastName, targetBand } = parsed.data;

  try {
    const recruit = await prisma.$transaction(async (tx) => {
      const row = await tx.recruitProspect.create({
        data: {
          firstName,
          lastName,
          targetBand,
          // Owner defaults to the logged-in admin; admin can re-
          // assign via the detail page if a different partner is
          // driving this prospect.
          ownerId: session!.person.id,
          status: 'active',
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'created',
        entity: {
          type: 'recruit_prospect',
          id: row.id,
          after: {
            name: `${firstName} ${lastName}`,
            targetBand,
            via: 'kanban_quick_add',
          },
        },
        source: 'web',
      });
      return row;
    });
    revalidatePath('/talent');
    return { status: 'success', recruitId: recruit.id };
  } catch (err) {
    console.error('[recruit.quickAdd] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }
}

const MoveSchema = z.object({
  id: z.string().min(1),
  /** Either move to a different band (still active), change status
   *  (nix / restore / convert), or set the funnel stage. All three
   *  surface through the same handler so the audit trail captures the
   *  kanban-card movement cleanly. */
  targetBand: TARGET_BAND_ENUM.optional(),
  status: STATUS_ENUM.optional(),
  /** Free-form stage string. The board uses canonical values
   *  (`screening` / `in_discussion` / `offer`) for drag-drop moves;
   *  detail-page edits can still write any free-form value. */
  stage: z.string().max(64).nullable().optional(),
});

export type MoveRecruitState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

/**
 * Move a recruit card on the kanban. Supports:
 *   - changing targetBand (column move within active board)
 *   - changing status to 'nixed' (move to Nixed column) — stamps closedAt
 *   - changing status to 'active' (restore from Nixed) — clears closedAt
 *
 * Converting to a Person uses `promoteRecruit` instead since that
 * flow involves Person creation, not just a status flip.
 */
export async function moveRecruit(
  _prev: MoveRecruitState,
  formData: FormData,
): Promise<MoveRecruitState> {
  const session = await getSession();
  try {
    requireCapability(session, 'recruit.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const rawStage = formData.get('stage');
  const parsed = MoveSchema.safeParse({
    id: formData.get('id'),
    targetBand: (formData.get('targetBand') as string) || undefined,
    status: (formData.get('status') as string) || undefined,
    stage:
      rawStage === null
        ? undefined
        : rawStage === ''
          ? null
          : (rawStage as string),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };
  const { id, targetBand, status, stage } = parsed.data;
  if (!targetBand && !status && stage === undefined) {
    return { status: 'error', message: 'Nothing to change' };
  }

  const existing = await prisma.recruitProspect.findUnique({ where: { id } });
  if (!existing) return { status: 'error', message: 'Recruit not found' };
  if (existing.status === 'converted') {
    return {
      status: 'error',
      message: 'This prospect has been converted to a team member — edit them on the Directory.',
    };
  }

  const patch: Record<string, unknown> = {};
  if (targetBand && targetBand !== existing.targetBand) patch.targetBand = targetBand;
  if (status && status !== existing.status) {
    patch.status = status;
    patch.closedAt = status === 'nixed' ? new Date() : null;
  }
  if (stage !== undefined && (stage ?? null) !== (existing.stage ?? null)) {
    patch.stage = stage;
  }
  if (Object.keys(patch).length === 0) return { status: 'success' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.recruitProspect.update({ where: { id }, data: patch });
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'updated',
        entity: {
          type: 'recruit_prospect',
          id,
          before: {
            targetBand: existing.targetBand,
            status: existing.status,
            stage: existing.stage,
          },
          after: {
            targetBand: patch.targetBand ?? existing.targetBand,
            status: patch.status ?? existing.status,
            stage: patch.stage !== undefined ? patch.stage : existing.stage,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[recruit.move] failed:', err);
    return { status: 'error', message: 'Move failed — try again.' };
  }

  revalidatePath('/talent');
  revalidatePath(`/talent/${id}`);
  return { status: 'success' };
}

/**
 * Pre-flight handoff to /directory/people/new with the prospect's
 * details as URL params. Doesn't itself create the Person — leaves
 * that to the existing new-person flow, which has its own M365
 * provisioning + role assignment logic. The recruit's status is
 * flipped to 'converted' + linkedPersonId is set in the new-person
 * action after the Person record lands (a hook the new-person action
 * watches for via the `?fromRecruit=<id>` param).
 *
 * Returns the redirect URL so the caller can render a server-action
 * form pointing at it.
 */
export async function startPromotionToPerson(
  _prev: MoveRecruitState,
  formData: FormData,
): Promise<MoveRecruitState> {
  const session = await getSession();
  try {
    requireCapability(session, 'recruit.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const id = String(formData.get('id') ?? '');
  if (!id) return { status: 'error', message: 'Missing id' };
  const r = await prisma.recruitProspect.findUnique({ where: { id } });
  if (!r) return { status: 'error', message: 'Recruit not found' };
  if (r.status === 'converted' && r.linkedPersonId) {
    redirect(`/directory/people/${r.linkedPersonId}`);
  }
  redirect(`/directory/people/new?fromRecruit=${id}`);
}

// ─── Inline field edit ───────────────────────────────────────────────

/**
 * Patch a single editable field on a recruit. Drives the inline-edit
 * affordance on the detail page (Contact rows + Notes panel). The
 * field name is constrained to the user-editable set; nothing else
 * is reachable from this handler.
 *
 * Admin-only via `recruit.manage` (super_admin). Refuses to mutate
 * converted prospects — once promoted to a Person, the Person record
 * is the source of truth; further edits should go there.
 *
 * Value validation per field:
 *   - email          → loose email format, max 254 chars, "" → null
 *   - linkedinUrl    → URL format, max 500 chars, "" → null
 *   - cvSharepointUrl → URL format, max 500 chars, "" → null
 *   - notes          → free text, max 4000 chars, "" → null
 *   - phone          → free text, max 40 chars, "" → null
 *   - location       → free text, max 120 chars, "" → null
 *   - source         → free text, max 200 chars, "" → null
 *   - stage          → free text, max 60 chars, "" → null
 */
export type PatchFieldState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const EDITABLE_FIELDS = [
  'email',
  'linkedinUrl',
  'cvSharepointUrl',
  'notes',
  'phone',
  'location',
  'source',
  'stage',
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

const FIELD_VALIDATORS: Record<EditableField, z.ZodTypeAny> = {
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: 'Doesn’t look like a valid email.',
    }),
  linkedinUrl: z.string().trim().max(500).refine(
    (v) => v === '' || /^https?:\/\/.+/i.test(v),
    {
      message: 'URL must start with http:// or https://',
    },
  ),
  cvSharepointUrl: z.string().trim().max(500).refine(
    (v) => v === '' || /^https?:\/\/.+/i.test(v),
    {
      message: 'URL must start with http:// or https://',
    },
  ),
  notes: z.string().max(4000),
  phone: z.string().trim().max(40),
  location: z.string().trim().max(120),
  source: z.string().trim().max(200),
  stage: z.string().trim().max(60),
};

export async function patchRecruitField(
  recruitId: string,
  _prev: PatchFieldState,
  formData: FormData,
): Promise<PatchFieldState> {
  const session = await getSession();
  try {
    requireCapability(session, 'recruit.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const fieldRaw = String(formData.get('field') ?? '');
  if (!EDITABLE_FIELDS.includes(fieldRaw as EditableField)) {
    return { status: 'error', message: 'Unknown field' };
  }
  const field = fieldRaw as EditableField;
  const validator = FIELD_VALIDATORS[field];
  const parsed = validator.safeParse(String(formData.get('value') ?? ''));
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid value',
    };
  }

  const existing = await prisma.recruitProspect.findUnique({
    where: { id: recruitId },
    select: { id: true, status: true, [field]: true },
  });
  if (!existing) return { status: 'error', message: 'Recruit not found' };
  if (existing.status === 'converted') {
    return {
      status: 'error',
      message:
        'This prospect has been converted to a team member — edit them on the Directory.',
    };
  }

  // Normalise empty string → null for nullable fields so the DB
  // doesn't accumulate "" strings that look like values but aren't.
  const trimmed = (parsed.data as string).trim();
  const nextValue = trimmed === '' ? null : trimmed;
  const beforeValue = (existing as Record<string, unknown>)[field] ?? null;
  if (beforeValue === nextValue) {
    // No-op — saves a write + audit row for a non-edit (e.g. blur
    // with no change). Treated as success so the UI doesn't blink
    // an error toast.
    return { status: 'success' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.recruitProspect.update({
        where: { id: recruitId },
        data: { [field]: nextValue },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'updated',
        entity: {
          type: 'recruit_prospect',
          id: recruitId,
          before: { [field]: beforeValue },
          after: { [field]: nextValue },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[recruit.patchField] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/talent/${recruitId}`);
  revalidatePath('/talent');
  return { status: 'success' };
}
