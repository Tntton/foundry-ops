import { prisma } from '@/server/db';

/**
 * Nightly backup skip-gate (TASK-069f). The nightly cron regenerates the
 * continuity ZIP + master ledger + every report workbook and pushes ~9
 * files to SharePoint. On a quiet day that's pointless churn (redundant
 * uploads, noisy version history + audit trail). Since A9 audits every
 * mutation, the audit log *is* the change feed: if nothing has changed
 * since the last successful backup, skip the whole run.
 *
 * The signal is intentionally global + coarse — one cheap indexed count.
 * On-demand regeneration is never gated (an explicit click always runs),
 * so a false "no changes" is harmless.
 */

// Audit actions that are themselves backups / exports / reads — NOT data
// mutations. Everything else in the log means real data changed.
const NON_MUTATION_ACTIONS = [
  'data_export_generated',
  'data_export_upload_failed',
  'ledger_backup_generated',
  'ledger_backup_upload_failed',
  'report_workbook_generated',
  'report_workbook_failed',
  'exported', // ledger CSV/xlsx download
  'nightly_export_skipped', // this gate's own skip marker
];

// Actions that mark a *successful* backup — used to find "last backup at".
const BACKUP_SUCCESS_ACTIONS = [
  'data_export_generated',
  'ledger_backup_generated',
  'report_workbook_generated',
];

export type BackupGate = {
  /** True → run the backup. False → nothing changed, skip. */
  changed: boolean;
  /** The most recent successful backup time, or null if none yet. */
  lastBackupAt: Date | null;
  /** Count of mutation audit rows since lastBackupAt (−1 when no prior
   *  backup exists and we run unconditionally). */
  changeCount: number;
};

export async function evaluateBackupGate(): Promise<BackupGate> {
  const lastBackup = await prisma.auditEvent.findFirst({
    where: { action: { in: BACKUP_SUCCESS_ACTIONS } },
    orderBy: { at: 'desc' },
    select: { at: true },
  });

  // Never backed up before → always run (bootstrap).
  if (!lastBackup) {
    return { changed: true, lastBackupAt: null, changeCount: -1 };
  }

  const changeCount = await prisma.auditEvent.count({
    where: {
      at: { gt: lastBackup.at },
      action: { notIn: NON_MUTATION_ACTIONS },
    },
  });

  return {
    changed: changeCount > 0,
    lastBackupAt: lastBackup.at,
    changeCount,
  };
}
