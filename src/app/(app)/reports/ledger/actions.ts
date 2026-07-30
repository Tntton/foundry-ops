'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { generateLedgerBackup } from '@/server/exports/ledger-backup';

export type LedgerBackupState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; rowCount: number; webUrl: string | null; uploadSkipped: boolean };

/**
 * On-demand master-ledger backup to SharePoint. Same pipeline as the
 * nightly cron, fired from the ledger tab. Gated on
 * `report.ledger.export` (super_admin / admin) since the workbook is
 * PII-bearing.
 */
export async function runLedgerBackupNowAction(
  _prev: LedgerBackupState,
  _formData: FormData,
): Promise<LedgerBackupState> {
  const session = await getSession();
  try {
    requireCapability(session, 'report.ledger.export');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  try {
    const res = await generateLedgerBackup({
      actor: { type: 'person', id: session!.person.id },
      source: 'web',
      via: 'manual',
    });
    revalidatePath('/reports/ledger');
    return {
      status: 'success',
      rowCount: res.rowCount,
      webUrl: res.webUrl,
      uploadSkipped: res.uploadSkipped,
    };
  } catch (err) {
    return {
      status: 'error',
      message: `Backup failed: ${(err as Error).message}`,
    };
  }
}
