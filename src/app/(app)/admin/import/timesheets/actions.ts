'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import {
  buildTimesheetPreview,
  commitTimesheetImport,
  type CommitTimesheetMode,
} from '@/server/imports/timesheets';
import { stashTimesheets, readTimesheets, discard } from '@/server/imports/cache';

export type ParseAction =
  | { ok: true; token: string }
  | { ok: false; message: string };

export async function parseTimesheetCsv(
  csvText: string,
  fileName: string,
): Promise<ParseAction> {
  const session = await getSession();
  try {
    requireCapability(session, 'timesheet.approve');
  } catch {
    return { ok: false, message: 'Not authorized to import timesheets.' };
  }
  const result = await buildTimesheetPreview(csvText, fileName);
  if (!result.ok) return { ok: false, message: result.error.message };
  const token = stashTimesheets(session.person.id, result.preview);
  return { ok: true, token };
}

export type CommitState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

export async function commitTimesheetCsv(
  _prev: CommitState,
  formData: FormData,
): Promise<CommitState> {
  const session = await getSession();
  try {
    requireCapability(session, 'timesheet.approve');
  } catch {
    return { status: 'error', message: 'Not authorized.' };
  }
  const token = (formData.get('token') as string | null) ?? '';
  const modeRaw = (formData.get('mode') as string | null) ?? 'skip_duplicates';
  if (!token) return { status: 'error', message: 'Missing token.' };
  const mode: CommitTimesheetMode =
    modeRaw === 'overwrite_duplicates' ? 'overwrite_duplicates' : 'skip_duplicates';
  const preview = readTimesheets(session.person.id, token);
  if (!preview) {
    return {
      status: 'error',
      message: 'Preview expired or already committed. Re-upload the file.',
    };
  }

  try {
    const result = await commitTimesheetImport(preview, session.person.id, mode);
    discard(token);
    revalidatePath('/timesheet');
    revalidatePath('/admin/audit');
    const params = new URLSearchParams({
      committed: '1',
      inserted: String(result.insertedCount),
      overwritten: String(result.overwrittenCount),
      skipped: String(result.skippedDuplicateCount),
      rejected: String(result.rejectedCount),
    });
    redirect(`/admin/import/timesheets?${params.toString()}`);
  } catch (err) {
    if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    console.error('[timesheet.import.commit] failed:', err);
    return { status: 'error', message: `Commit failed: ${(err as Error).message}` };
  }
}
