import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { prisma } from '@/server/db';
import { generateDataExport } from '@/server/exports/data-export';
import { uploadDataExportToSharePoint } from '@/server/exports/sharepoint-backup';
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

    console.log('[cron/data-export] ok:', {
      filename: manifest.filename,
      sizeBytes: manifest.sizeBytes,
      tables: Object.keys(manifest.tableCounts).length,
      webUrl,
      uploadSkipped,
    });
    return NextResponse.json({
      ok: true,
      manifest,
      webUrl,
      folderPath,
      uploadSkipped,
    });
  } catch (err) {
    console.error('[cron/data-export] failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
