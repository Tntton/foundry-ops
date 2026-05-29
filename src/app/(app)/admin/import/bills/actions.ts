'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import {
  buildBillsPreview,
  commitBillsImport,
  type CommitBillsMode,
} from '@/server/imports/bills';
import { stashBills, readBills, discard } from '@/server/imports/cache';

export type ParseAction =
  | { ok: true; token: string }
  | { ok: false; message: string };

export async function parseBillsCsv(
  csvText: string,
  fileName: string,
): Promise<ParseAction> {
  const session = await getSession();
  try {
    requireCapability(session, 'bill.create');
  } catch {
    return { ok: false, message: 'Not authorized to import bills.' };
  }
  const result = await buildBillsPreview(csvText, fileName);
  if (!result.ok) return { ok: false, message: result.error.message };
  const token = stashBills(session.person.id, result.preview);
  return { ok: true, token };
}

export type CommitState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

export async function commitBillsCsv(
  _prev: CommitState,
  formData: FormData,
): Promise<CommitState> {
  const session = await getSession();
  try {
    requireCapability(session, 'bill.create');
  } catch {
    return { status: 'error', message: 'Not authorized.' };
  }
  const token = (formData.get('token') as string | null) ?? '';
  const modeRaw = (formData.get('mode') as string | null) ?? 'skip_duplicates';
  if (!token) return { status: 'error', message: 'Missing token.' };
  const mode: CommitBillsMode =
    modeRaw === 'force_create' ? 'force_create' : 'skip_duplicates';
  const preview = readBills(session.person.id, token);
  if (!preview) {
    return {
      status: 'error',
      message: 'Preview expired or already committed. Re-upload the file.',
    };
  }
  try {
    const result = await commitBillsImport(preview, session.person.id, mode);
    discard(token);
    revalidatePath('/bills');
    revalidatePath('/admin/audit');
    const params = new URLSearchParams({
      committed: '1',
      inserted: String(result.insertedCount),
      skipped: String(result.skippedDuplicateCount),
      rejected: String(result.rejectedCount),
    });
    redirect(`/admin/import/bills?${params.toString()}`);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    console.error('[bills.import.commit] failed:', err);
    return { status: 'error', message: `Commit failed: ${(err as Error).message}` };
  }
}
