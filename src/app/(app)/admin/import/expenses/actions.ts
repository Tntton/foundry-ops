'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import {
  buildExpensesPreview,
  commitExpensesImport,
} from '@/server/imports/expenses';
import { stashExpenses, readExpenses, discard } from '@/server/imports/cache';

export type ParseAction =
  | { ok: true; token: string }
  | { ok: false; message: string };

export async function parseExpensesCsv(
  csvText: string,
  fileName: string,
): Promise<ParseAction> {
  const session = await getSession();
  try {
    // Importing expenses on behalf of multiple staff is approval-tier
    // work — same gate as approving under-$2k expenses.
    requireCapability(session, 'expense.approve.under_2k');
  } catch {
    return { ok: false, message: 'Not authorized to import expenses.' };
  }
  const result = await buildExpensesPreview(csvText, fileName);
  if (!result.ok) return { ok: false, message: result.error.message };
  const token = stashExpenses(session.person.id, result.preview);
  return { ok: true, token };
}

export type CommitState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

export async function commitExpensesCsv(
  _prev: CommitState,
  formData: FormData,
): Promise<CommitState> {
  const session = await getSession();
  try {
    requireCapability(session, 'expense.approve.under_2k');
  } catch {
    return { status: 'error', message: 'Not authorized.' };
  }
  const token = (formData.get('token') as string | null) ?? '';
  if (!token) return { status: 'error', message: 'Missing token.' };
  const preview = readExpenses(session.person.id, token);
  if (!preview) {
    return {
      status: 'error',
      message: 'Preview expired or already committed. Re-upload the file.',
    };
  }
  try {
    const result = await commitExpensesImport(preview, session.person.id);
    discard(token);
    revalidatePath('/expenses');
    revalidatePath('/admin/audit');
    const params = new URLSearchParams({
      committed: '1',
      inserted: String(result.insertedCount),
      rejected: String(result.rejectedCount),
    });
    redirect(`/admin/import/expenses?${params.toString()}`);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    console.error('[expenses.import.commit] failed:', err);
    return { status: 'error', message: `Commit failed: ${(err as Error).message}` };
  }
}
