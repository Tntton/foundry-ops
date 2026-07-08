import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { uploadReceiptToSharePoint } from '@/server/integrations/sharepoint-receipts';
import { graphConfigured } from '@/server/graph';

/**
 * One-off backfill: move receipt / attachment files that were stored as
 * inline `data:base64,...` URLs on Expense.receiptSharepointUrl and
 * Bill.attachmentSharepointUrl to the corporate SharePoint FY archive
 * (TASK-042b / TASK-046b).
 *
 * Before this migration, the /bills/intake OCR flow stored the raw
 * file as a base64 data URL in the DB — heavy rows, unindexable, no
 * audit trail, no compliance-friendly folder. This script decodes each
 * data URL, uploads to SharePoint via the shared uploader (same folder
 * layout the new submission paths use), updates the row with the real
 * webUrl + driveItemId, and writes an AuditEvent per migrated row.
 *
 * Run modes:
 *   pnpm backfill:receipts             # apply
 *   pnpm backfill:receipts --dry       # preview (no writes, no uploads)
 *   pnpm backfill:receipts --limit=50  # cap batch size
 *
 * Idempotency: the script filters on `receiptSharepointUrl LIKE 'data:%'`
 * / `LIKE 'pending-upload://%'` — once a row has been migrated its URL
 * starts with https:// and it's skipped on the next run.
 *
 * Failure modes surfaced but non-fatal:
 *   - Graph not configured → script exits without writes.
 *   - A single row's upload fails → logged, script continues to next
 *     row. The failed row keeps its data-URL and is picked up next run.
 *
 * Audit: one AuditEvent per migrated row (action='backfilled',
 * source='integration_sync') plus a summary log at the end.
 */

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1] ?? '0', 10) : 0;

type InlinePayload = { mimeType: string; base64: string } | null;

function parseInlineUrl(url: string | null): InlinePayload {
  if (!url) return null;
  if (!url.startsWith('data:')) return null;
  const semi = url.indexOf(';');
  const comma = url.indexOf(',', semi);
  if (semi === -1 || comma === -1) return null;
  const mimeType = url.slice(5, semi);
  const base64 = url.slice(comma + 1);
  if (!base64 || !mimeType) return null;
  return { mimeType, base64 };
}

async function migrateExpenses(): Promise<{
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
}> {
  const rows = await prisma.expense.findMany({
    where: {
      receiptSharepointUrl: { startsWith: 'data:' },
    },
    include: {
      person: { select: { id: true, initials: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: LIMIT > 0 ? LIMIT : undefined,
  });
  console.log(`  found ${rows.length} expense rows with inline receipts`);
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const payload = parseInlineUrl(row.receiptSharepointUrl);
    if (!payload) {
      skipped += 1;
      console.warn(`  [${row.id}] could not parse data URL, skipping`);
      continue;
    }
    if (DRY) {
      console.log(`  [${row.id}] would upload ${payload.mimeType} (${payload.base64.length}b64) for ${row.vendor ?? 'no-vendor'} ($${(row.amount / 100).toFixed(2)}) on ${row.date.toISOString().slice(0, 10)}`);
      migrated += 1;
      continue;
    }
    try {
      const buffer = Buffer.from(payload.base64, 'base64');
      const shortId = row.id.slice(-8);
      const upload = await uploadReceiptToSharePoint({
        kind: 'expense',
        date: row.date,
        vendor: row.vendor,
        amountCents: row.amount,
        ownerInitials: row.person.initials,
        id: shortId,
        buffer,
        mimeType: payload.mimeType,
      });
      if (!upload) {
        failed += 1;
        console.warn(`  [${row.id}] upload returned null (SharePoint not configured?)`);
        continue;
      }
      await prisma.$transaction(async (tx) => {
        await tx.expense.update({
          where: { id: row.id },
          data: {
            receiptSharepointUrl: upload.webUrl,
            receiptDriveItemId: upload.driveItemId,
          },
        });
        await writeAudit(tx, {
          actor: { type: 'system' },
          action: 'backfilled',
          entity: {
            type: 'expense',
            id: row.id,
            after: {
              via: 'sharepoint_receipt_backfill',
              from: 'data-url-inline',
              to: {
                webUrl: upload.webUrl,
                driveItemId: upload.driveItemId,
                filename: upload.filename,
              },
              originalSizeBytes: buffer.length,
            },
          },
          source: 'integration_sync',
        });
      });
      migrated += 1;
      if (migrated % 10 === 0) console.log(`  progress: ${migrated} expenses migrated`);
    } catch (err) {
      failed += 1;
      console.error(`  [${row.id}] failed:`, (err as Error).message);
    }
  }
  return { scanned: rows.length, migrated, skipped, failed };
}

async function migrateBills(): Promise<{
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
}> {
  const rows = await prisma.bill.findMany({
    where: {
      attachmentSharepointUrl: { startsWith: 'data:' },
    },
    orderBy: { createdAt: 'asc' },
    take: LIMIT > 0 ? LIMIT : undefined,
  });
  console.log(`  found ${rows.length} bill rows with inline attachments`);
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const payload = parseInlineUrl(row.attachmentSharepointUrl);
    if (!payload) {
      skipped += 1;
      continue;
    }
    if (DRY) {
      console.log(`  [${row.id}] would upload ${payload.mimeType} for ${row.supplierName ?? 'no-supplier'} ($${(row.amountTotal / 100).toFixed(2)}) on ${row.issueDate.toISOString().slice(0, 10)}`);
      migrated += 1;
      continue;
    }
    try {
      const buffer = Buffer.from(payload.base64, 'base64');
      const shortId = row.id.slice(-8);
      const upload = await uploadReceiptToSharePoint({
        kind: 'bill',
        date: row.issueDate,
        vendor: row.supplierName,
        amountCents: row.amountTotal,
        ownerInitials: 'FH', // Firm-attributed — bills don't carry a person
        id: shortId,
        buffer,
        mimeType: payload.mimeType,
      });
      if (!upload) {
        failed += 1;
        continue;
      }
      await prisma.$transaction(async (tx) => {
        await tx.bill.update({
          where: { id: row.id },
          data: {
            attachmentSharepointUrl: upload.webUrl,
            attachmentDriveItemId: upload.driveItemId,
          },
        });
        await writeAudit(tx, {
          actor: { type: 'system' },
          action: 'backfilled',
          entity: {
            type: 'bill',
            id: row.id,
            after: {
              via: 'sharepoint_receipt_backfill',
              from: 'data-url-inline',
              to: {
                webUrl: upload.webUrl,
                driveItemId: upload.driveItemId,
                filename: upload.filename,
              },
              originalSizeBytes: buffer.length,
            },
          },
          source: 'integration_sync',
        });
      });
      migrated += 1;
    } catch (err) {
      failed += 1;
      console.error(`  [${row.id}] failed:`, (err as Error).message);
    }
  }
  return { scanned: rows.length, migrated, skipped, failed };
}

async function main() {
  console.log(`[backfill:receipts] mode=${DRY ? 'DRY' : 'APPLY'} limit=${LIMIT || 'all'}`);
  if (!DRY && !graphConfigured()) {
    console.error(
      '[backfill:receipts] Graph not configured — set ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET / SHAREPOINT_SITE_URL and retry. Aborting.',
    );
    process.exit(1);
  }
  console.log('[backfill:receipts] expenses:');
  const expenses = await migrateExpenses();
  console.log('[backfill:receipts] bills:');
  const bills = await migrateBills();
  console.log('[backfill:receipts] summary:', {
    expenses,
    bills,
    total: {
      scanned: expenses.scanned + bills.scanned,
      migrated: expenses.migrated + bills.migrated,
      skipped: expenses.skipped + bills.skipped,
      failed: expenses.failed + bills.failed,
    },
  });
}

main()
  .catch((err) => {
    console.error('[backfill:receipts] fatal:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
