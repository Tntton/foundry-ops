-- ============================================================================
-- Foundry Ops — Phase 8 migrations (TASK-500 … TASK-506)
-- Generated for the Supabase SQL Editor. Run this whole file ONCE, in one go.
--
-- Contains the four migrations in order, plus the matching _prisma_migrations
-- ledger rows so `prisma migrate status` stays in sync afterwards and you do
-- NOT need to run `prisma migrate resolve`.
--
-- Everything is wrapped in a single transaction: if any statement fails, the
-- whole thing rolls back and the database is untouched. Re-run safely.
--
-- BEFORE running, run the pre-flight query (sent separately) so you have a
-- record of any rows the TASK-500 backfill can't resolve. RAISE NOTICE output
-- is not reliably shown in the SQL Editor.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 20260901000000_timesheet_contractor_bill_link
-- ─────────────────────────────────────────────────────────────────────────
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

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES
  (gen_random_uuid()::text, 'e2ff0cff0d25e756eb671ec40abb427bc4177b02286779bb7fce8ddf04969637', now(), '20260901000000_timesheet_contractor_bill_link', NULL, NULL, now(), 1)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 20260901010000_timesheet_period
-- ─────────────────────────────────────────────────────────────────────────
-- TASK-501 — TimesheetPeriod: a person's calendar month as a single lodgeable unit.
--
-- Before this, "submitted" was only a property scattered across N
-- TimesheetEntry rows with no object representing the month, so every
-- downstream stage re-derived its own grouping and they all disagreed
-- (approval queue by week, contractor draft-bill all-time, client
-- draft-invoice by arbitrary range).
--
-- Rows are created lazily on first read of a month; there is no backfill.
-- A month with no row is `open` by definition, so existing data needs no
-- migration.

CREATE TYPE "TimesheetPeriodState" AS ENUM ('open', 'lodged', 'approved', 'invoiced');

CREATE TABLE "TimesheetPeriod" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "state" "TimesheetPeriodState" NOT NULL DEFAULT 'open',
    "lodgedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "contractorBillId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimesheetPeriod_pkey" PRIMARY KEY ("id")
);

-- One row per person per calendar month. This is what makes the lodge action
-- idempotent under a double-tap or a two-tab race.
CREATE UNIQUE INDEX "TimesheetPeriod_personId_year_month_key"
  ON "TimesheetPeriod"("personId", "year", "month");

CREATE INDEX "TimesheetPeriod_state_idx" ON "TimesheetPeriod"("state");
CREATE INDEX "TimesheetPeriod_year_month_idx" ON "TimesheetPeriod"("year", "month");

ALTER TABLE "TimesheetPeriod"
  ADD CONSTRAINT "TimesheetPeriod_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL rather than RESTRICT: deleting a draft contractor bill should
-- release the period to be re-invoiced, exactly as deleting a draft client
-- invoice releases its timesheet hours (TASK-500).
ALTER TABLE "TimesheetPeriod"
  ADD CONSTRAINT "TimesheetPeriod_contractorBillId_fkey"
  FOREIGN KEY ("contractorBillId") REFERENCES "Bill"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES
  (gen_random_uuid()::text, 'b7c33f67e3942afa3e912247d08d97de7aad36f777065ac1907dd63f1c701193', now(), '20260901010000_timesheet_period', NULL, NULL, now(), 1)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 20260901020000_period_invoice_draft
-- ─────────────────────────────────────────────────────────────────────────
-- TASK-504 — freeze the contractor's invoice numbers when the period closes.
--
-- Foundry does not issue this invoice; the contractor does (D1, TT
-- 2026-08-31). But the figures they're asked to confirm have to be the ones
-- the approvals produced. Without a snapshot, editing Person.rate between
-- close and confirm would silently reprice a month that was already signed
-- off — and the contractor would be confirming a number nobody approved.
--
-- Only the rate is frozen. Line grouping is recomputed from the period's
-- entries at confirm time, which is safe because a closed period's entries
-- are all `approved` and can no longer move.

ALTER TABLE "TimesheetPeriod" ADD COLUMN "draftRateCents" INTEGER;
ALTER TABLE "TimesheetPeriod" ADD COLUMN "draftHours" DECIMAL(8,2);
ALTER TABLE "TimesheetPeriod" ADD COLUMN "draftAmountExGstCents" INTEGER;
ALTER TABLE "TimesheetPeriod" ADD COLUMN "draftPreparedAt" TIMESTAMP(3);

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES
  (gen_random_uuid()::text, 'cc158cc840e8172f17a4d33817d659804c08ab0b353e3c02f2544b673dd8655c', now(), '20260901020000_period_invoice_draft', NULL, NULL, now(), 1)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 20260901030000_period_chase_tracking
-- ─────────────────────────────────────────────────────────────────────────
-- TASK-506 — chase tracking for lodged months.
--
-- D2 (TT 2026-08-31) closes a month only when every project in it is
-- approved. The cost of that choice is that one unresponsive approver blocks
-- a contractor's invoice, and therefore their payment. A daily cron nudges
-- the specific people who owe a decision — these columns stamp the nudges so
-- it chases on an interval instead of emitting a feed row every single day.

ALTER TABLE "TimesheetPeriod" ADD COLUMN "lastChasedAt" TIMESTAMP(3);
ALTER TABLE "TimesheetPeriod" ADD COLUMN "escalatedAt" TIMESTAMP(3);

-- Lets the cron find candidates without scanning every period ever lodged.
CREATE INDEX "TimesheetPeriod_state_lodgedAt_idx"
  ON "TimesheetPeriod"("state", "lodgedAt");

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES
  (gen_random_uuid()::text, '37edfd17346170748fd946c239c8abd68e18f08e7ea8cc8bc0a79d2105ff1966', now(), '20260901030000_period_chase_tracking', NULL, NULL, now(), 1)
ON CONFLICT DO NOTHING;

COMMIT;
