'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { requireSession } from '@/server/roles';
import { draftInvoiceFromTimesheets } from '@/server/invoice-drafter';

const DraftSchema = z.object({
  projectId: z.string().min(1),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});

export type DraftFromTimeState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

export async function createInvoiceFromTimesheets(
  _prev: DraftFromTimeState,
  formData: FormData,
): Promise<DraftFromTimeState> {
  const session = await getSession();
  try {
    requireSession(session);
    requireCapability(session, 'invoice.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = DraftSchema.safeParse({
    projectId: formData.get('projectId'),
    periodStart: formData.get('periodStart'),
    periodEnd: formData.get('periodEnd'),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };
  if (parsed.data.periodEnd.getTime() <= parsed.data.periodStart.getTime()) {
    return { status: 'error', message: 'Period end must be after period start.' };
  }

  let invoiceId: string;
  try {
    const r = await draftInvoiceFromTimesheets(
      session,
      parsed.data.projectId,
      parsed.data.periodStart,
      parsed.data.periodEnd,
    );
    invoiceId = r.invoiceId;
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }

  revalidatePath('/invoices');
  redirect(`/invoices/${invoiceId}`);
}
