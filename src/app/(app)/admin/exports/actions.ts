'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { generateDataExport } from '@/server/exports/data-export';
import { uploadDataExportToSharePoint } from '@/server/exports/sharepoint-backup';
import { runAllReportWorkbookBackups } from '@/server/exports/report-workbooks';

export type RunExportState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      filename: string;
      sizeBytes: number;
      webUrl: string | null;
      folderPath: string | null;
      uploadSkipped: boolean;
      tableCounts: Record<string, number>;
    };

/**
 * Admin-triggered export. Same pipeline as the nightly cron, but
 * fires synchronously from the dashboard so the operator can pull
 * a fresh snapshot at any time (e.g. just before stepping into a
 * planned maintenance window).
 *
 * Audited as `data_export_generated` with `via: 'manual'` in the
 * delta so the audit log can distinguish admin-triggered exports
 * from the cron-driven ones.
 */
export async function runDataExportNowAction(
  _prev: RunExportState,
  _formData: FormData,
): Promise<RunExportState> {
  const session = await getSession();
  try {
    // Gated on integration.manage — that's the closest existing
    // capability for "admin-tier ops surface" without spinning up
    // a dedicated `data_export.run` capability. Refine if the
    // surface grows.
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
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
        // Graph not configured — manifest still useful as a
        // record of "the snapshot was taken locally", but the
        // operator needs to fix SHAREPOINT_* env vars to land it.
        uploadSkipped = true;
      }
    } catch (uploadErr) {
      console.error('[manual data-export] upload failed:', uploadErr);
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'person', id: session!.person.id },
          action: 'data_export_upload_failed',
          entity: {
            type: 'integration',
            id: 'sharepoint-backup',
            after: {
              ...manifest,
              via: 'manual',
              error: (uploadErr as Error).message,
            },
          },
          source: 'web',
        });
      });
      return {
        status: 'error',
        message: `Upload failed: ${(uploadErr as Error).message}`,
      };
    }

    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'data_export_generated',
        entity: {
          type: 'integration',
          id: 'sharepoint-backup',
          after: {
            ...manifest,
            via: 'manual',
            webUrl,
            folderPath,
            uploadSkipped,
          },
        },
        source: 'web',
      });
    });

    revalidatePath('/admin/exports');
    return {
      status: 'success',
      filename: manifest.filename,
      sizeBytes: manifest.sizeBytes,
      webUrl,
      folderPath,
      uploadSkipped,
      tableCounts: manifest.tableCounts,
    };
  } catch (err) {
    console.error('[manual data-export] failed:', err);
    return {
      status: 'error',
      message: (err as Error).message ?? 'Export failed — see server logs.',
    };
  }
}

export type RunWorkbooksState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      results: { name: string; ok: boolean; webUrl: string | null; uploadSkipped: boolean }[];
    };

/**
 * Admin-triggered regeneration of the themed reporting workbooks
 * (Phase 1F — Finance, Timesheet, etc.). Same pipeline as the nightly
 * cron, fired synchronously. Gated on `integration.manage` to match the
 * rest of this admin surface.
 */
export async function runReportWorkbooksNowAction(
  _prev: RunWorkbooksState,
  _formData: FormData,
): Promise<RunWorkbooksState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  try {
    const results = await runAllReportWorkbookBackups({
      actor: { type: 'person', id: session!.person.id },
      source: 'web',
      via: 'manual',
    });
    revalidatePath('/admin/exports');
    return {
      status: 'success',
      results: results.map((r) => ({
        name: r.name,
        ok: r.ok,
        webUrl: r.webUrl,
        uploadSkipped: r.uploadSkipped,
      })),
    };
  } catch (err) {
    return {
      status: 'error',
      message: (err as Error).message ?? 'Workbook regeneration failed.',
    };
  }
}
