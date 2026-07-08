-- TASK-042b / TASK-046b · SharePoint receipts + attachments
--
-- Adds Graph DriveItem ids to Expense + Bill so the proxied inline-
-- preview route (/api/attachments/[kind]/[id]) can stream the file
-- back to approvers without leaving Foundry Ops. Paired with the
-- existing *SharepointUrl columns which store the human-clickable
-- webUrl. Both are null for legacy rows that predate the upload flow
-- (see scripts/backfill_receipts_to_sharepoint.ts).

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "receiptDriveItemId" TEXT;

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "attachmentDriveItemId" TEXT;
