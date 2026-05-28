'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';

export type MeUpdateState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> }
  | { status: 'success'; message: string };

/**
 * Self-edit: only contact-style fields a staff member can change about
 * themselves. Band / level / rate / billRate / employment / FTE /
 * roles / start date / end date / bank / super / TFN are all locked —
 * those are HR-controlled and live on the admin-side `/directory/people/[id]/edit`
 * surface gated by `person.edit` capability.
 *
 * Email is also locked (it's the auth identity — changes have to go
 * through a separate verification flow).
 */
const SelfEditSchema = z.object({
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal('').transform(() => null)),
  // E.164 — leading + and 8–15 digits. Nullable when empty.
  whatsappNumber: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .refine(
      (v) => v === null || /^\+[1-9]\d{7,14}$/.test(v),
      'Use E.164 format (e.g. +61412345678)',
    ),
  mailingAddress: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => null)),
});

export async function updateOwnContactDetails(
  _prev: MeUpdateState,
  formData: FormData,
): Promise<MeUpdateState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const parsed = SelfEditSchema.safeParse({
    phone: formData.get('phone'),
    whatsappNumber: formData.get('whatsappNumber'),
    mailingAddress: formData.get('mailingAddress'),
  });
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

  const me = await prisma.person.findUnique({
    where: { id: session.person.id },
    select: {
      id: true,
      phone: true,
      whatsappNumber: true,
      mailingAddress: true,
    },
  });
  if (!me) return { status: 'error', message: 'Profile not found' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: me.id },
        data: {
          phone: data.phone ?? null,
          whatsappNumber: data.whatsappNumber,
          mailingAddress: data.mailingAddress ?? null,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: me.id },
        action: 'updated',
        entity: {
          type: 'person',
          id: me.id,
          before: {
            phone: me.phone,
            whatsappNumber: me.whatsappNumber,
            mailingAddress: me.mailingAddress,
          },
          after: {
            phone: data.phone ?? null,
            whatsappNumber: data.whatsappNumber,
            mailingAddress: data.mailingAddress ?? null,
            via: 'self_edit',
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[me.update] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/me');
  revalidatePath(`/directory/people/${me.id}`);
  return { status: 'success', message: 'Saved.' };
}

// ─── Bank account ──────────────────────────────────────────────────────
//
// International-friendly. The `bankCountry` ISO code selects which
// fields are required: AU asks for BSB+Acc, everything else asks for
// SWIFT/IBAN. The schema lets you fill any combination — useful for
// staff with hybrid arrangements (e.g. AU bank, intl IBAN).

const BankSchema = z
  .object({
    bankCountry: z
      .string()
      .trim()
      .max(2)
      .transform((s) => s.toUpperCase())
      .default('AU'),
    bankAccountName: z
      .string()
      .trim()
      .max(120)
      .optional()
      .or(z.literal('').transform(() => null)),
    bankName: z
      .string()
      .trim()
      .max(120)
      .optional()
      .or(z.literal('').transform(() => null)),
    bankBsb: z
      .string()
      .trim()
      .transform((s) => s.replace(/[\s-]/g, ''))
      .nullable()
      .or(z.literal('').transform(() => null))
      .refine(
        (s) => s === null || /^[0-9]{6}$/.test(s),
        'BSB must be 6 digits',
      ),
    bankAcc: z
      .string()
      .trim()
      .max(40)
      .optional()
      .or(z.literal('').transform(() => null)),
    bankSwift: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase().replace(/\s/g, ''))
      .nullable()
      .or(z.literal('').transform(() => null))
      .refine(
        (s) => s === null || /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(s),
        'SWIFT/BIC must be 8 or 11 alphanumeric characters',
      ),
    bankIban: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase().replace(/\s/g, ''))
      .nullable()
      .or(z.literal('').transform(() => null))
      .refine(
        (s) => s === null || /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(s),
        'IBAN format invalid',
      ),
  })
  .refine(
    (v) => {
      // AU requires BSB + Acc when filling in. Other countries expect
      // SWIFT or IBAN. Empty rows are fine — staff can save partial.
      const filledAny =
        v.bankAccountName ||
        v.bankBsb ||
        v.bankAcc ||
        v.bankSwift ||
        v.bankIban ||
        v.bankName;
      if (!filledAny) return true;
      if (v.bankCountry === 'AU') {
        return Boolean(v.bankBsb && v.bankAcc);
      }
      return Boolean(v.bankSwift || v.bankIban);
    },
    {
      message:
        'AU accounts need BSB + Acc. Other countries need SWIFT/BIC or IBAN.',
      path: ['bankCountry'],
    },
  );

export async function updateOwnBankDetails(
  _prev: MeUpdateState,
  formData: FormData,
): Promise<MeUpdateState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const parsed = BankSchema.safeParse({
    bankCountry: formData.get('bankCountry') ?? 'AU',
    bankAccountName: formData.get('bankAccountName'),
    bankName: formData.get('bankName'),
    bankBsb: formData.get('bankBsb'),
    bankAcc: formData.get('bankAcc'),
    bankSwift: formData.get('bankSwift'),
    bankIban: formData.get('bankIban'),
  });
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

  const me = await prisma.person.findUnique({
    where: { id: session.person.id },
    select: { id: true, bankCountry: true },
  });
  if (!me) return { status: 'error', message: 'Profile not found' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: me.id },
        data: {
          bankCountry: data.bankCountry,
          bankAccountName: data.bankAccountName,
          bankName: data.bankName,
          bankBsb: data.bankBsb,
          bankAcc: data.bankAcc,
          bankSwift: data.bankSwift,
          bankIban: data.bankIban,
        },
      });
      // Audit row stores ONLY a structural diff — never the actual digits.
      // PII redaction is a hard rule per CLAUDE.md security notes.
      await writeAudit(tx, {
        actor: { type: 'person', id: me.id },
        action: 'updated',
        entity: {
          type: 'person',
          id: me.id,
          before: { bankDetails: 'redacted' },
          after: { via: 'self_edit_bank', bankCountry: data.bankCountry },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[me.bank] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }
  revalidatePath('/me');
  return { status: 'success', message: 'Bank details saved.' };
}

// ─── Emergency contact ─────────────────────────────────────────────────

const EmergencySchema = z.object({
  emergencyContactName: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => null)),
  emergencyContactRelationship: z
    .string()
    .trim()
    .max(60)
    .optional()
    .or(z.literal('').transform(() => null)),
  emergencyContactPhone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal('').transform(() => null)),
  emergencyContactEmail: z
    .string()
    .trim()
    .email()
    .max(254)
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
});

export async function updateOwnEmergencyContact(
  _prev: MeUpdateState,
  formData: FormData,
): Promise<MeUpdateState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const parsed = EmergencySchema.safeParse({
    emergencyContactName: formData.get('emergencyContactName'),
    emergencyContactRelationship: formData.get('emergencyContactRelationship'),
    emergencyContactPhone: formData.get('emergencyContactPhone'),
    emergencyContactEmail: formData.get('emergencyContactEmail'),
  });
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

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: session.person.id },
        data: {
          emergencyContactName: data.emergencyContactName,
          emergencyContactRelationship: data.emergencyContactRelationship,
          emergencyContactPhone: data.emergencyContactPhone,
          emergencyContactEmail: data.emergencyContactEmail,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'person',
          id: session.person.id,
          after: { via: 'self_edit_emergency_contact' },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[me.emergency] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }
  revalidatePath('/me');
  return { status: 'success', message: 'Emergency contact saved.' };
}

// ─── Public profile (website blurb + additional roles) ────────────────

const PublicProfileSchema = z.object({
  websiteBlurb: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal('').transform(() => null)),
  // Roles arrive as comma-separated text from the form; we split + clean
  // here so users don't have to edit a raw array.
  additionalRolesCsv: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => '')),
});

export async function updateOwnPublicProfile(
  _prev: MeUpdateState,
  formData: FormData,
): Promise<MeUpdateState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const parsed = PublicProfileSchema.safeParse({
    websiteBlurb: formData.get('websiteBlurb'),
    additionalRolesCsv: formData.get('additionalRolesCsv'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const csv = parsed.data.additionalRolesCsv ?? '';
  const additionalRoles = csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 80)
    .slice(0, 12);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: session.person.id },
        data: {
          websiteBlurb: parsed.data.websiteBlurb ?? null,
          additionalRoles,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'person',
          id: session.person.id,
          after: {
            via: 'self_edit_public_profile',
            additionalRoles,
            websiteBlurbLength:
              parsed.data.websiteBlurb?.length ?? 0,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[me.publicProfile] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }
  revalidatePath('/me');
  return { status: 'success', message: 'Public profile saved.' };
}

// ─── Asset upload (CV + headshot) ─────────────────────────────────────

const AssetSchema = z.object({
  kind: z.enum(['cv', 'headshot']),
  fileBase64: z.string().min(1),
  fileMime: z.string().min(1),
  fileName: z.string().min(1).max(200),
});

const ASSET_SIZE_CAP = 10 * 1024 * 1024; // 10 MB raw
const ASSET_BASE64_CAP = ASSET_SIZE_CAP * 1.4;

export async function uploadOwnAsset(
  _prev: MeUpdateState,
  formData: FormData,
): Promise<MeUpdateState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const parsed = AssetSchema.safeParse({
    kind: formData.get('kind'),
    fileBase64: formData.get('fileBase64'),
    fileMime: formData.get('fileMime'),
    fileName: formData.get('fileName'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid upload',
    };
  }
  const { kind, fileBase64, fileMime, fileName } = parsed.data;
  if (fileBase64.length > ASSET_BASE64_CAP) {
    return { status: 'error', message: 'File too large — max 10 MB.' };
  }

  // Mime gate: CV must be a PDF, headshot must be an image. Avoids the
  // user accidentally swapping the slots and ending up with a JPG in
  // the CV link or a 30-page PDF as their headshot.
  if (kind === 'cv' && fileMime !== 'application/pdf') {
    return { status: 'error', message: 'CV must be a PDF.' };
  }
  if (kind === 'headshot' && !fileMime.startsWith('image/')) {
    return { status: 'error', message: 'Headshot must be an image (JPEG/PNG/WebP).' };
  }

  const dataUrl = `data:${fileMime};base64,${fileBase64}`;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: session.person.id },
        data: kind === 'cv' ? { cvUrl: dataUrl } : { headshotUrl: dataUrl },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'person',
          id: session.person.id,
          after: {
            via: 'self_edit_asset_upload',
            kind,
            fileName,
            fileMime,
            fileSize: fileBase64.length,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[me.uploadAsset] failed:', err);
    return { status: 'error', message: 'Upload failed — try again.' };
  }
  revalidatePath('/me');
  return {
    status: 'success',
    message: `${kind === 'cv' ? 'CV' : 'Headshot'} uploaded.`,
  };
}

// ─── Cropped headshot upload (self + admin-on-behalf) ─────────────────
//
// Used by the LinkedIn-style cropper. The client component renders the
// cropped square to a JPEG data URL on canvas; we just persist it. A
// `targetPersonId` lets super_admin / admin upload on behalf of anyone
// (covers staff who haven't set theirs up + onboarding the next hire's
// first-day asset). When omitted, the action targets the caller's own
// row.

const HeadshotSchema = z.object({
  targetPersonId: z.string().optional().nullable(),
  dataUrl: z
    .string()
    .min(1)
    .refine(
      (v) => v.startsWith('data:image/'),
      'Headshot must be a data URL of an image',
    ),
});

const HEADSHOT_DATA_URL_CAP = 5 * 1024 * 1024; // 5 MB after base64 — generous for a 512×512 JPEG @ 0.92

export async function setHeadshotFromCrop(
  _prev: MeUpdateState,
  formData: FormData,
): Promise<MeUpdateState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const parsed = HeadshotSchema.safeParse({
    targetPersonId: formData.get('targetPersonId'),
    dataUrl: formData.get('dataUrl'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { targetPersonId, dataUrl } = parsed.data;
  if (dataUrl.length > HEADSHOT_DATA_URL_CAP) {
    return {
      status: 'error',
      message: 'Cropped image too large — try a lower zoom or smaller source.',
    };
  }

  // If setting someone else's headshot, the caller has to be an admin.
  // Self-edit always works (signed-in person updating their own row).
  const subjectId = targetPersonId && targetPersonId !== ''
    ? targetPersonId
    : session.person.id;
  const isSelf = subjectId === session.person.id;
  if (!isSelf && !hasAnyRole(session, ['super_admin', 'admin'])) {
    return {
      status: 'error',
      message: 'Only super_admin / admin can set another staff member\'s headshot.',
    };
  }

  const subject = await prisma.person.findUnique({
    where: { id: subjectId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!subject) return { status: 'error', message: 'Person not found' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: subject.id },
        data: { headshotUrl: dataUrl },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'person',
          id: subject.id,
          after: {
            via: isSelf
              ? 'self_edit_headshot_crop'
              : 'admin_set_headshot_crop',
            targetSubject: isSelf ? undefined : subject.id,
            // Persist size only — the actual data URL stays out of the
            // audit row (already on the Person row, no point duplicating
            // a multi-MB blob into the audit log).
            dataUrlBytes: dataUrl.length,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[me.headshotCrop] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/me');
  revalidatePath(`/directory/people/${subject.id}`);
  return {
    status: 'success',
    message: isSelf ? 'Headshot saved.' : `Headshot saved for ${subject.firstName} ${subject.lastName}.`,
  };
}
