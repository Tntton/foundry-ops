-- TASK-500 — decouple the contractor-bill (AP) leg from the client-invoice (AR) leg.
--
-- Before this migration the contractor draft-bill flow marked consumed hours
-- with TimesheetEntry.status = 'billed'. previewInvoiceFromTimesheets filters
-- status = 'approved', so billing a contractor SILENTLY and PERMANENTLY removed
-- those hours from the client-invoice pool (and, symmetrically, invoicing the
-- client first hid the hours from the contractor's own bill, which filters
-- billedInvoiceId IS NULL).
--
-- The two legs are economically independent: the same hour is a cost at
-- Person.rate and revenue at Person.billRate. Each now gets its own nullable FK.
--
-- Order matters below: add the column, backfill the historical rows off the
-- audit trail, move every remaining 'billed' row to 'approved', and only then
-- drop the now-unwritable enum value.

-- ─── 1. AP-leg FK ───────────────────────────────────────────────────────────
ALTER TABLE "TimesheetEntry" ADD COLUMN "contractorBillId" TEXT;

CREATE INDEX "TimesheetEntry_contractorBillId_idx" ON "TimesheetEntry"("contractorBillId");

ALTER TABLE "TimesheetEntry"
  ADD CONSTRAINT "TimesheetEntry_contractorBillId_fkey"
  FOREIGN KEY ("contractorBillId") REFERENCES "Bill"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── 2. Backfill from the audit trail ───────────────────────────────────────
-- generateDraftBillFromHours recorded the consumed entry ids on the bill's
-- `created` audit event. writeAudit stores a created-entity payload as
-- entityDelta = { "created": { … , "timesheetEntryIds": [...] } }.
-- Resolve each 'billed' row back to the Bill that consumed it.
UPDATE "TimesheetEntry" te
SET "contractorBillId" = ae."entityId"
FROM "AuditEvent" ae
CROSS JOIN LATERAL jsonb_array_elements_text(
  ae."entityDelta" -> 'created' -> 'timesheetEntryIds'
) AS entry_id
WHERE ae."entityType" = 'bill'
  AND ae."action" = 'created'
  AND ae."entityDelta" -> 'created' ->> 'source' = 'timesheet_draft_bill'
  AND jsonb_typeof(ae."entityDelta" -> 'created' -> 'timesheetEntryIds') = 'array'
  AND te."id" = entry_id
  AND te."status" = 'billed'
  AND te."contractorBillId" IS NULL
  -- Only link to a Bill that still exists; the FK would reject anything else.
  AND EXISTS (SELECT 1 FROM "Bill" b WHERE b."id" = ae."entityId");

-- ─── 3. Report what could not be resolved, then release it ──────────────────
-- Unmatchable rows (bill deleted, audit event pruned, or hours marked billed
-- before the audit payload carried entry ids) are NOT guessed at. They return
-- to 'approved' with a null contractorBillId — i.e. billable to the client
-- again, and eligible to appear on the contractor's next draft bill. Both are
-- recoverable by a human; silently inventing a bill link is not.
DO $$
DECLARE
  unresolved_count INTEGER;
  resolved_count   INTEGER;
BEGIN
  SELECT count(*) INTO resolved_count
    FROM "TimesheetEntry"
   WHERE "status" = 'billed' AND "contractorBillId" IS NOT NULL;

  SELECT count(*) INTO unresolved_count
    FROM "TimesheetEntry"
   WHERE "status" = 'billed' AND "contractorBillId" IS NULL;

  RAISE NOTICE 'TASK-500 backfill: % billed entries linked to their contractor bill.', resolved_count;

  IF unresolved_count > 0 THEN
    RAISE NOTICE 'TASK-500 backfill: % billed entries could NOT be matched to a bill..created audit event. Released to status=approved with contractorBillId NULL — REVIEW THESE MANUALLY (they are now billable to the client and will reappear on the contractor draft bill):', unresolved_count;
    RAISE NOTICE '%', (
      SELECT string_agg(
               format('  entry=%s person=%s project=%s date=%s hours=%s',
                      te."id", te."personId", te."projectId", te."date", te."hours"),
               E'\n' ORDER BY te."date"
             )
        FROM "TimesheetEntry" te
       WHERE te."status" = 'billed' AND te."contractorBillId" IS NULL
    );
  END IF;
END $$;

UPDATE "TimesheetEntry" SET "status" = 'approved' WHERE "status" = 'billed';

-- ─── 4. Retire the enum value ───────────────────────────────────────────────
-- No writer remains (the sole one was generateDraftBillFromHours, rewired in
-- the same branch). Dropping it makes "an hour's AP state is never encoded in
-- its status" an invariant the database enforces, so the bug cannot regress.
ALTER TYPE "TimesheetStatus" RENAME TO "TimesheetStatus_old";

CREATE TYPE "TimesheetStatus" AS ENUM ('draft', 'submitted', 'approved');

ALTER TABLE "TimesheetEntry" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "TimesheetEntry"
  ALTER COLUMN "status" TYPE "TimesheetStatus"
  USING ("status"::text::"TimesheetStatus");

ALTER TABLE "TimesheetEntry" ALTER COLUMN "status" SET DEFAULT 'draft';

DROP TYPE "TimesheetStatus_old";
