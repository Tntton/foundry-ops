'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { optionalEnv } from '@/server/env';
import { provisionM365User } from '@/server/integrations/m365';

const FOUNDRY_SUFFIX = '@foundry.health';

const NewPersonSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  initialsOverride: z.string().trim().max(6).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsappNumber: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]*$/u, 'Digits, spaces, + and - only')
    .max(40)
    .optional()
    .nullable(),
  band: z.enum(['MP', 'Partner', 'Expert', 'Consultant', 'Analyst']),
  level: z.string().trim().min(1).max(10),
  employment: z.enum(['ft', 'contractor']),
  fte: z.coerce.number().min(0.1).max(1.0),
  region: z.enum(['AU', 'NZ']),
  rateUnit: z.enum(['hour', 'day']),
  rateDollars: z.coerce.number().min(0).max(10_000),
  startDate: z.coerce.date(),
  roles: z.array(z.enum(['super_admin', 'admin', 'partner', 'manager', 'staff'])),
  jobTitle: z.string().trim().max(120).optional().nullable(),
});

export type NewPersonState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function createPerson(
  _prev: NewPersonState,
  formData: FormData,
): Promise<NewPersonState> {
  const session = await getSession();
  try {
    requireCapability(session, 'person.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = NewPersonSchema.safeParse({
    email: formData.get('email'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    initialsOverride: formData.get('initialsOverride') || null,
    phone: formData.get('phone') || null,
    whatsappNumber: formData.get('whatsappNumber') || null,
    band: formData.get('band'),
    level: formData.get('level'),
    employment: formData.get('employment'),
    fte: formData.get('fte'),
    region: formData.get('region'),
    rateUnit: formData.get('rateUnit'),
    rateDollars: formData.get('rateDollars'),
    startDate: formData.get('startDate'),
    roles: formData.getAll('roles'),
    jobTitle: formData.get('jobTitle') || null,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }
  const data = parsed.data;

  if (data.employment === 'ft' && !data.email.endsWith(FOUNDRY_SUFFIX)) {
    return {
      status: 'error',
      message: 'FT staff must have an @foundry.health email.',
      fieldErrors: { email: 'Must end with @foundry.health for FT' },
    };
  }

  const emailTaken = await prisma.person.findUnique({ where: { email: data.email } });
  if (emailTaken) {
    return {
      status: 'error',
      message: 'Email already used by another person.',
      fieldErrors: { email: 'Already in use' },
    };
  }

  const initials = await ensureUniqueInitials(
    (data.initialsOverride && data.initialsOverride.toUpperCase()) ||
      deriveInitials(data.firstName, data.lastName),
  );

  let entraUserId: string | null = null;
  let temporaryPassword: string | null = null;
  const provisioningOn = optionalEnv('ENABLE_PROVISIONING') === '1';
  if (provisioningOn && data.employment === 'ft') {
    try {
      const result = await provisionM365User({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        jobTitle: data.jobTitle ?? undefined,
      });
      if (result) {
        entraUserId = result.entraUserId;
        temporaryPassword = result.temporaryPassword;
      }
    } catch (err) {
      console.error('[person.create] M365 provisioning failed:', err);
      return {
        status: 'error',
        message: `M365 provisioning failed: ${(err as Error).message}. Retry from the detail page, or disable ENABLE_PROVISIONING to create without.`,
      };
    }
  }

  let newId: string;
  try {
    newId = await prisma.$transaction(async (tx) => {
      const person = await tx.person.create({
        data: {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          initials,
          phone: data.phone,
          whatsappNumber: data.whatsappNumber,
          band: data.band,
          level: data.level,
          employment: data.employment,
          fte: data.fte,
          region: data.region,
          rateUnit: data.rateUnit,
          rate: Math.round(data.rateDollars * 100),
          roles: data.roles,
          startDate: data.startDate,
          entraUserId,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'person',
          id: person.id,
          after: {
            email: person.email,
            initials: person.initials,
            band: person.band,
            level: person.level,
            employment: person.employment,
            roles: person.roles,
            entraUserId: person.entraUserId,
            m365Provisioned: entraUserId !== null,
          },
        },
        source: 'web',
      });
      return person.id;
    });
  } catch (err) {
    console.error('[person.create] DB insert failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/directory');
  // If a temp password was issued, surface it via a query param ONE time for the
  // admin to copy before the user forces a reset. Gone on refresh.
  const suffix = temporaryPassword
    ? `?tempPassword=${encodeURIComponent(temporaryPassword)}`
    : '';
  redirect(`/directory/people/${newId}${suffix}`);
}

function deriveInitials(firstName: string, lastName: string): string {
  const first = firstName[0]?.toUpperCase() ?? 'X';
  const last = lastName[0]?.toUpperCase() ?? 'X';
  return `${first}${last}`;
}

async function ensureUniqueInitials(base: string): Promise<string> {
  let candidate = base;
  let suffix = 1;
  while (await prisma.person.findUnique({ where: { initials: candidate } })) {
    suffix += 1;
    candidate = `${base}${suffix}`;
    if (suffix > 99) throw new Error(`Could not generate unique initials for ${base}`);
  }
  return candidate;
}
