import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { prisma } from '@/server/db';
import { generateDataExport } from '@/server/exports/data-export';
import { uploadDataExportToSharePoint } from '@/server/exports/sharepoint-backup';
import { generateLedgerBackup } from '@/server/exports/ledger-backup';
import { runAllReportWorkbookBackups } from '@/server/exports/report-workbooks';
import { evaluateBackupGate } from '@/server/exports/backup-gate';
import { writeAudit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 5 min — the export is a few hundred KB at firm scale, but the
// SharePoint upload + Graph site lookup + folder ensure-or-create
// adds a few seconds of latency per call. Plenty of headroom.
export const maxDuration = 300;

/**
 * Scheduled business-continuity export. Vercel Cron hits this
 * endpoint via the shared `CRON_SECRET` (same pattern as the Xero
 * + Navan + Uber crons).
 *
 * What it does:
 *   1. Snapshots the critical operating tables → ZIP of CSVs
 *      (`generateDataExport` — read-only, no mutations)
 *   2. Uploads the ZIP to SharePoint Admin → 00 Backups →
 *      data-exports → <today>/<filename> (admin-tier folder ACL
 *      enforced at the SharePoint side)
 *   3. Writes an AuditEvent so the trail records WHO (system
 *      actor) wrote WHAT (manifest + URL) WHEN
 *
 * Failure handling: any step that throws is caught and surfaces in
 * the cron logs + a `data_export_failed` audit row so a Vercel-
 * logs-grep + an audit-log-grep both flag the failure. The cron
 * fires daily, so a missed run is recoverable on the next slot.
 *
 * Schedule lives in `vercel.json` — see the `data-export` entry.
 */
export async function GET(req: Request) {
  const cronSecret = requireEnv('CRON_SECRET');
  const auth = req.headers.get('authorization');
  const url = new URL(req.url);
  const providedKey =
    auth?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('key') ?? '';
  if (providedKey !== cronSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // Skip-gate: if nothing has changed since the last successful backup,
    // don't regenerate/upload anything (TASK-069f). On-demand triggers are
    // never gated, so a false negative is harmless.
    const gate = await evaluateBackupGate();
    if (!gate.changed) {
      console.log('[cron/data-export] no changes since last backup — skipping', {
        lastBackupAt: gate.lastBackupAt,
      });
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'system' },
          action: 'nightly_export_skipped',
          entity: {
            type: 'integration',
            id: 'sharepoint-backup',
            after: {
              via: 'cron',
              reason: 'no_changes',
              lastBackupAt: gate.lastBackupAt?.toISOString() ?? null,
            },
          },
          source: 'integration_sync',
        });
      });
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'no_changes',
        lastBackupAt: gate.lastBackupAt,
      });
    }

    const { manifest, buffer } = await generateDataExport();
    let webUrl: string | null = null;
    let folderPath: string | null = null;
    let uploadSkipped = false;
    try {
      const result = await uploadDataExportToSharePoint({
        buffer,
        filename: manifest.filename,
      });
      if (result) {
        webUrl = result.webUrl;
        folderPath = result.folderPath;
      } else {
        uploadSkipped = true;
      }
    } catch (uploadErr) {
      // Upload failure shouldn't kill the cron — the generated
      // bytes are gone (held in-process only) but we still want to
      // record the attempt + the error for the operator to see.
      console.error('[cron/data-export] SharePoint upload failed:', uploadErr);
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'system' },
          action: 'data_export_upload_failed',
          entity: {
            type: 'integration',
            id: 'sharepoint-backup',
            after: {
              ...manifest,
              error: (uploadErr as Error).message,
            },
          },
          source: 'integration_sync',
        });
      });
      return NextResponse.json(
        { error: 'upload failed', manifest, message: (uploadErr as Error).message },
        { status: 500 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'system' },
        action: 'data_export_generated',
        entity: {
          type: 'integration',
          id: 'sharepoint-backup',
          after: {
            ...manifest,
            webUrl,
            folderPath,
            uploadSkipped,
          },
        },
        source: 'integration_sync',
      });
    });

    // Also refresh the master-ledger workbook in SharePoint (TASK-069c).
    // Best-effort + independently audited — a ledger-backup failure must
    // not fail the already-successful data-export run.
    let ledgerBackup: { rowCount: number; webUrl: string | null; uploadSkipped: boolean } | null =
      null;
    try {
      ledgerBackup = await generateLedgerBackup({
        actor: { type: 'system' },
        source: 'integration_sync',
        via: 'cron',
      });
    } catch (ledgerErr) {
      console.error('[cron/data-export] ledger backup failed:', ledgerErr);
    }

    // Refresh the themed reporting workbooks (Phase 1F) too. Each entry
    // is independently audited and best-effort — never fails the cron.
    let reportWorkbooks: { name: string; ok: boolean }[] = [];
    try {
      reportWorkbooks = (
        await runAllReportWorkbookBackups({
          actor: { type: 'system' },
          source: 'integration_sync',
          via: 'cron',
        })
      ).map((r) => ({ name: r.name, ok: r.ok }));
    } catch (wbErr) {
      console.error('[cron/data-export] report workbooks failed:', wbErr);
    }

    console.log('[cron/data-export] ok:', {
      filename: manifest.filename,
      sizeBytes: manifest.sizeBytes,
      tables: Object.keys(manifest.tableCounts).length,
      webUrl,
      uploadSkipped,
      ledgerRows: ledgerBackup?.rowCount ?? null,
      reportWorkbooks,
    });
    return NextResponse.json({
      ok: true,
      manifest,
      webUrl,
      folderPath,
      uploadSkipped,
      ledgerBackup,
      reportWorkbooks,
    });
  } catch (err) {
    console.error('[cron/data-export] failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
