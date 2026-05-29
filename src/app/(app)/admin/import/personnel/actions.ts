'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import {
  buildPersonnelPreview,
  commitPersonnelImport,
} from '@/server/imports/personnel';
import { stashPersonnel, readPersonnel, discard } from '@/server/imports/cache';

export type ParseAction =
  | { ok: true; token: string }
  | { ok: false; message: string };

/**
 * Step 1 — parse + validate the CSV. Returns a token the client uses
 * to navigate to the preview screen. Doesn't write anything to the DB.
 */
export async function parsePersonnelCsv(
  csvText: string,
  fileName: string,
): Promise<ParseAction> {
  const session = await getSession();
  try {
    requireCapability(session, 'person.create');
  } catch {
    return { ok: false, message: 'Not authorized to import personnel.' };
  }

  const result = await buildPersonnelPreview(csvText, fileName);
  if (!result.ok) return { ok: false, message: result.error.message };
  const token = stashPersonnel(session.person.id, result.preview);
  return { ok: true, token };
}

export type CommitState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

/**
 * Step 2 — commit the stashed preview. Re-reads the preview from the
 * in-memory cache by token + user id (never re-trusts the original CSV).
 * Writes to the DB + audit row in a single transaction.
 */
export async function commitPersonnelCsv(
  _prev: CommitState,
  formData: FormData,
): Promise<CommitState> {
  const session = await getSession();
  try {
    requireCapability(session, 'person.create');
  } catch {
    return { status: 'error', message: 'Not authorized.' };
  }

  const token = (formData.get('token') as string | null) ?? '';
  if (!token) return { status: 'error', message: 'Missing token.' };
  const preview = readPersonnel(session.person.id, token);
  if (!preview) {
    return {
      status: 'error',
      message: 'Preview expired or already committed. Re-upload the file.',
    };
  }
  if (preview.errorCount > 0 || preview.duplicateEmails.length > 0) {
    return {
      status: 'error',
      message: 'Preview has errors — fix the CSV and re-upload.',
    };
  }

  try {
    const result = await commitPersonnelImport(preview, session.person.id);
    discard(token);
    revalidatePath('/directory');
    revalidatePath('/admin/audit');
    const params = new URLSearchParams({
      committed: '1',
      new: String(result.newCount),
      updated: String(result.updatedCount),
    });
    redirect(`/admin/import/personnel?${params.toString()}`);
  } catch (err) {
    // redirect() throws — let it bubble
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    console.error('[personnel.import.commit] failed:', err);
    return { status: 'error', message: `Commit failed: ${(err as Error).message}` };
  }
}
