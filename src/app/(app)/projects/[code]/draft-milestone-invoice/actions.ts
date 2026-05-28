'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { requireSession } from '@/server/roles';
import { draftInvoiceFromMilestones } from '@/server/invoice-drafter';

const Schema = z
  .object({
    projectId: z.string().min(1),
    milestoneIds: z.array(z.string().min(1)).max(50),
    rebillableBillIds: z.array(z.string().min(1)).default([]),
    rebillableExpenseIds: z.array(z.string().min(1)).default([]),
  })
  .refine(
    (v) =>
      v.milestoneIds.length > 0 ||
      v.rebillableBillIds.length > 0 ||
      v.rebillableExpenseIds.length > 0,
    { message: 'Pick at least one milestone or pass-through cost.' },
  );

export type DraftFromMilestonesState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

export async function createInvoiceFromMilestones(
  _prev: DraftFromMilestonesState,
  formData: FormData,
): Promise<DraftFromMilestonesState> {
  const session = await getSession();
  try {
    requireSession(session);
    requireCapability(session, 'invoice.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = Schema.safeParse({
    projectId: formData.get('projectId'),
    milestoneIds: formData.getAll('milestoneIds').map(String),
    rebillableBillIds: formData.getAll('rebillableBillIds').map(String),
    rebillableExpenseIds: formData.getAll('rebillableExpenseIds').map(String),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  let invoiceId: string;
  try {
    const r = await draftInvoiceFromMilestones(
      session,
      parsed.data.projectId,
      parsed.data.milestoneIds,
      parsed.data.rebillableBillIds,
      parsed.data.rebillableExpenseIds,
    );
    invoiceId = r.invoiceId;
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }

  revalidatePath('/invoices');
  redirect(`/invoices/${invoiceId}`);
}
