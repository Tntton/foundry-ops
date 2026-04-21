'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { requireSession } from '@/server/roles';
import { draftInvoiceFromMilestones } from '@/server/invoice-drafter';

const Schema = z.object({
  projectId: z.string().min(1),
  milestoneIds: z.array(z.string().min(1)).min(1).max(50),
});

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
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Pick at least one milestone.' };
  }

  let invoiceId: string;
  try {
    const r = await draftInvoiceFromMilestones(
      session,
      parsed.data.projectId,
      parsed.data.milestoneIds,
    );
    invoiceId = r.invoiceId;
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }

  revalidatePath('/invoices');
  redirect(`/invoices/${invoiceId}`);
}
