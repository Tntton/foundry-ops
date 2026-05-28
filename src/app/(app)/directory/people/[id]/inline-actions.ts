'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';

export type InlineFieldState =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Whitelisted set of single-field inline edits on the personnel file.
 * Each entry validates the value, names the underlying Prisma column,
 * and flags whether it's safe for self-edit (`selfEditable`) or admin-
 * only. Anything affecting access (band, level, employment, fte, roles)
 * still routes through the deliberate full-form edit page.
 */
const FIELD_RULES: Record<
  string,
  {
    column: string;
    schema: z.ZodTypeAny;
    selfEditable: boolean;
  }
> = {
  firstName: {
    column: 'firstName',
    schema: z.string().trim().min(1).max(120),
    selfEditable: true,
  },
  lastName: {
    column: 'lastName',
    schema: z.string().trim().min(1).max(120),
    selfEditable: true,
  },
  phone: {
    column: 'phone',
    schema: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    selfEditable: true,
  },
  whatsappNumber: {
    column: 'whatsappNumber',
    schema: z
      .string()
      .trim()
      .regex(/^\+?[0-9\s-]*$/u, 'Digits, spaces, + and - only')
      .max(40)
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    selfEditable: true,
  },
  linkedinUrl: {
    column: 'linkedinUrl',
    // Lightweight URL check — accepts plain "linkedin.com/in/foo" or
    // a full URL, normalises to https:// when missing.
    schema: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .transform((v) => {
        if (!v) return null;
        let url = v;
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        return url;
      })
      .refine((v) => v === null || /linkedin\.com/i.test(v), {
        message: 'Must be a linkedin.com URL',
      }),
    selfEditable: true,
  },
  mailingAddress: {
    column: 'mailingAddress',
    schema: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    selfEditable: true,
  },
  emergencyContactName: {
    column: 'emergencyContactName',
    schema: z
      .string()
      .trim()
      .max(160)
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    selfEditable: true,
  },
  emergencyContactRelationship: {
    column: 'emergencyContactRelationship',
    schema: z
      .string()
      .trim()
      .max(80)
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    selfEditable: true,
  },
  emergencyContactPhone: {
    column: 'emergencyContactPhone',
    schema: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    selfEditable: true,
  },
  emergencyContactEmail: {
    column: 'emergencyContactEmail',
    schema: z
      .string()
      .trim()
      .max(160)
      .nullable()
      .transform((v) => (v && v.length > 0 ? v : null)),
    selfEditable: true,
  },
};

const SCHEMA = z.object({
  field: z.string().min(1).max(80),
  // `null` is encoded as the literal string "" by FormData; we coerce
  // back inside the per-field schema (transform).
  value: z.string().nullable(),
});

/**
 * Per-field inline update. Self-edit allowed for whitelisted fields;
 * admin/super_admin/partner can edit anyone's. Uses the per-field
 * Zod schema above to validate + normalise. Audited as a person update.
 */
export async function updatePersonField(
  personId: string,
  _prev: InlineFieldState,
  formData: FormData,
): Promise<InlineFieldState> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Not signed in' };

  const parsed = SCHEMA.safeParse({
    field: formData.get('field'),
    value: formData.get('value') === null ? null : String(formData.get('value')),
  });
  if (!parsed.success) return { ok: false, message: 'Invalid input' };

  const rule = FIELD_RULES[parsed.data.field];
  if (!rule) {
    return { ok: false, message: `Field "${parsed.data.field}" not editable inline.` };
  }

  const isSelf = personId === session.person.id;
  const canActOnBehalf = hasAnyRole(session, [
    'super_admin',
    'admin',
    'partner',
  ]);
  if (!isSelf && !canActOnBehalf) {
    return { ok: false, message: 'Not authorized' };
  }
  if (isSelf && !rule.selfEditable) {
    return { ok: false, message: 'This field requires admin to change.' };
  }

  const valueParsed = rule.schema.safeParse(parsed.data.value);
  if (!valueParsed.success) {
    return {
      ok: false,
      message: valueParsed.error.issues[0]?.message ?? 'Invalid value',
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.person.findUnique({
        where: { id: personId },
        select: { [rule.column]: true } as Record<string, true>,
      });
      await tx.person.update({
        where: { id: personId },
        data: { [rule.column]: valueParsed.data },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'person',
          id: personId,
          before: before
            ? { [rule.column]: (before as Record<string, unknown>)[rule.column] }
            : null,
          after: {
            via: 'inline_edit',
            field: parsed.data.field,
            value: valueParsed.data,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[person.inline-edit] failed:', err);
    return { ok: false, message: 'Save failed — try again.' };
  }

  revalidatePath(`/directory/people/${personId}`);
  revalidatePath('/directory');
  return { ok: true };
}
