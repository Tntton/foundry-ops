import type { AuditSource } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit, type AuditActor } from '@/server/audit';
import { assembleLedger } from '@/server/reports/ledger';
import { ledgerToWorkbook } from '@/server/reports/ledger-export';
import { uploadWorkbookToSharePoint } from '@/server/exports/excel-workbook';

/**
 * Master-ledger SharePoint backup (TASK-069c). Assembles the full
 * ledger, builds the workbook, and publishes it to the Reports folder as
 * a single always-current `Master-Ledger.xlsx` (TASK-060 atomic
 * overwrite) so Jas always finds the latest at a stable path. Dated
 * historical snapshots are already covered by the nightly data-export
 * ZIP. Runs nightly (cron, system actor) and on demand (ledger tab,
 * person actor). Every run is audited; a Graph outage degrades to a
 * skip, not a failure.
 */

export type LedgerBackupResult = {
  rowCount: number;
  webUrl: string | null;
  uploadSkipped: boolean; // Graph not configured
};

export async function generateLedgerBackup(opts: {
  actor: AuditActor;
  source: AuditSource;
  /** Distinguishes cron vs manual runs in the audit delta. */
  via: string;
}): Promise<LedgerBackupResult> {
  const rows = await assembleLedger();
  const buffer = ledgerToWorkbook(rows);

  let webUrl: string | null = null;
  let uploadSkipped = false;
  try {
    const res = await uploadWorkbookToSharePoint({
      workbookName: 'Master-Ledger',
      buffer,
    });
    if (res) webUrl = res.webUrl;
    else uploadSkipped = true; // Graph not configured
  } catch (err) {
    console.error('[ledger-backup] SharePoint upload failed:', err);
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: opts.actor,
        action: 'ledger_backup_upload_failed',
        entity: {
          type: 'report',
          id: 'ledger_backup',
          after: {
            via: opts.via,
            rowCount: rows.length,
            error: (err as Error).message,
          },
        },
        source: opts.source,
      });
    });
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: opts.actor,
      action: 'ledger_backup_generated',
      entity: {
        type: 'report',
        id: 'ledger_backup',
        after: { via: opts.via, rowCount: rows.length, webUrl, uploadSkipped },
      },
      source: opts.source,
    });
  });

  return { rowCount: rows.length, webUrl, uploadSkipped };
}
