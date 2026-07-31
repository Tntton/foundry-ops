import type { AuditSource } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit, type AuditActor } from '@/server/audit';
import { uploadWorkbookToSharePoint } from '@/server/exports/excel-workbook';
import { buildFinanceWorkbook } from '@/server/exports/finance-workbook';
import { buildTimesheetWorkbook } from '@/server/exports/timesheet-workbook';

/**
 * Registry of the themed reporting workbooks (Phase 1F). Each entry
 * builds an .xlsx buffer; the runner publishes it to the SharePoint
 * Reports folder (TASK-060 atomic overwrite) and audits the run. The
 * nightly cron and the admin "regenerate" button both loop over this
 * list, so adding a workbook is a single registry entry — no new cron or
 * button wiring per task.
 */

export type ReportWorkbook = {
  /** SharePoint filename stem → `<name>.xlsx` in the Reports folder. */
  name: string;
  /** Human label for logs / audit / the admin surface. */
  label: string;
  build: () => Promise<Buffer>;
};

export const REPORT_WORKBOOKS: readonly ReportWorkbook[] = [
  {
    name: 'Finance',
    label: 'Finance (P&L · Cash · AR aging · AP aging)',
    build: buildFinanceWorkbook,
  },
  {
    name: 'Timesheet',
    label: 'Timesheet (by person · by project · utilisation)',
    build: buildTimesheetWorkbook,
  },
];

export type WorkbookBackupResult = {
  name: string;
  ok: boolean;
  webUrl: string | null;
  uploadSkipped: boolean;
  error?: string;
};

export async function runReportWorkbookBackup(
  entry: ReportWorkbook,
  opts: { actor: AuditActor; source: AuditSource; via: string },
): Promise<WorkbookBackupResult> {
  try {
    const buffer = await entry.build();
    let webUrl: string | null = null;
    let uploadSkipped = false;
    const res = await uploadWorkbookToSharePoint({
      workbookName: entry.name,
      buffer,
    });
    if (res) webUrl = res.webUrl;
    else uploadSkipped = true; // Graph not configured

    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: opts.actor,
        action: 'report_workbook_generated',
        entity: {
          type: 'report',
          id: `workbook:${entry.name}`,
          after: { via: opts.via, label: entry.label, webUrl, uploadSkipped },
        },
        source: opts.source,
      });
    });
    return { name: entry.name, ok: true, webUrl, uploadSkipped };
  } catch (err) {
    console.error(`[report-workbooks] ${entry.name} failed:`, err);
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: opts.actor,
        action: 'report_workbook_failed',
        entity: {
          type: 'report',
          id: `workbook:${entry.name}`,
          after: { via: opts.via, error: (err as Error).message },
        },
        source: opts.source,
      });
    });
    return {
      name: entry.name,
      ok: false,
      webUrl: null,
      uploadSkipped: false,
      error: (err as Error).message,
    };
  }
}

/** Regenerate every registered workbook. One entry failing doesn't stop
 *  the rest — each is independently audited. */
export async function runAllReportWorkbookBackups(opts: {
  actor: AuditActor;
  source: AuditSource;
  via: string;
}): Promise<WorkbookBackupResult[]> {
  const results: WorkbookBackupResult[] = [];
  for (const entry of REPORT_WORKBOOKS) {
    results.push(await runReportWorkbookBackup(entry, opts));
  }
  return results;
}
