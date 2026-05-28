'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';

export type RegularDaysFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const HoursField = z.coerce.number().min(0).max(24).int();

const Schema = z.object({
  personId: z.string().min(1),
  enabled: z.union([z.literal('1'), z.literal('0')]).transform((v) => v === '1'),
  mon: HoursField,
  tue: HoursField,
  wed: HoursField,
  thu: HoursField,
  fri: HoursField,
  sat: HoursField,
  sun: HoursField,
});

/**
 * Save a person's "regular days" weekly schedule + the toggle that
 * controls whether the availability editor pre-fills empty cells from
 * it. Self-edit always allowed; admin/partner/manager can edit anyone's.
 */
export async function saveRegularDays(
  _prev: RegularDaysFormState,
  formData: FormData,
): Promise<RegularDaysFormState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const parsed = Schema.safeParse({
    personId: formData.get('personId'),
    enabled: formData.get('enabled') ?? '0',
    mon: formData.get('mon') ?? '0',
    tue: formData.get('tue') ?? '0',
    wed: formData.get('wed') ?? '0',
    thu: formData.get('thu') ?? '0',
    fri: formData.get('fri') ?? '0',
    sat: formData.get('sat') ?? '0',
    sun: formData.get('sun') ?? '0',
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { personId, enabled, mon, tue, wed, thu, fri, sat, sun } = parsed.data;

  const isSelf = personId === session.person.id;
  if (
    !isSelf &&
    !hasAnyRole(session, ['super_admin', 'admin', 'partner', 'manager'])
  ) {
    return { status: 'error', message: 'Not authorized' };
  }

  const target = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, endDate: true, inactiveAt: true },
  });
  if (!target) return { status: 'error', message: 'Person not found' };
  if (target.endDate !== null) {
    return { status: 'error', message: 'Person is no longer active.' };
  }
  if (target.inactiveAt !== null) {
    return {
      status: 'error',
      message:
        'Profile is marked inactive — reactivate it to update the regular schedule.',
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: personId },
        data: {
          regularDaysEnabled: enabled,
          regularMonHours: mon,
          regularTueHours: tue,
          regularWedHours: wed,
          regularThuHours: thu,
          regularFriHours: fri,
          regularSatHours: sat,
          regularSunHours: sun,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'person',
          id: personId,
          after: {
            via: isSelf ? 'self_regular_days' : 'admin_regular_days',
            enabled,
            schedule: { mon, tue, wed, thu, fri, sat, sun },
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[availability.regular-days] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/availability');
  revalidatePath('/resource-planning');
  return { status: 'success' };
}
