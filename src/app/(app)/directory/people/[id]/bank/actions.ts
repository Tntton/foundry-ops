'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { encryptText } from '@/server/crypto';

const BankDetailsSchema = z.object({
  bsb: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s|-/g, ''))
    .pipe(z.string().regex(/^\d{6}$/u, '6-digit BSB'))
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  acc: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s|-/g, ''))
    .pipe(z.string().regex(/^\d{1,9}$/u, '1-9 digit account number'))
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

export type BankDetailsState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> }
  | { status: 'success'; message: string };

export async function saveBankDetails(
  personId: string,
  _prev: BankDetailsState,
  formData: FormData,
): Promise<BankDetailsState> {
  const session = await getSession();
  try {
    requireCapability(session, 'person.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = BankDetailsSchema.safeParse({
    bsb: formData.get('bsb'),
    acc: formData.get('acc'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, bankBsb: true, bankAcc: true },
  });
  if (!person) return { status: 'error', message: 'Person not found' };

  const bankBsb = parsed.data.bsb ? encryptText(parsed.data.bsb) : null;
  const bankAcc = parsed.data.acc ? encryptText(parsed.data.acc) : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: personId },
        data: { bankBsb, bankAcc },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'bank_details_updated',
        entity: {
          type: 'person',
          id: personId,
          before: {
            hadBsb: person.bankBsb !== null,
            hadAcc: person.bankAcc !== null,
          },
          after: {
            hasBsb: bankBsb !== null,
            hasAcc: bankAcc !== null,
            // NEVER log the actual values — bank details are PII and the
            // audit log is more broadly readable than the bank-details page.
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[person.bank] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/directory/people/${personId}`);
  revalidatePath(`/directory/people/${personId}/bank`);
  return { status: 'success', message: 'Bank details saved.' };
}
