-- Re-drop TimesheetStatus.billed.
--
-- WHY THIS EXISTS SEPARATELY FROM TASK-500's MIGRATION
-- ----------------------------------------------------
-- 20260901000000_timesheet_contractor_bill_link already removes this enum
-- value, and on any database migrated from scratch it is gone by the time
-- this file runs — hence the guard below, which makes this a no-op there.
--
-- Production is the exception. On 2026-09-06 the Phase 8 migrations were
-- applied to prod ahead of the code that goes with them (the branch was not
-- yet merged; `main` was still on 11 July). The deployed code still queried
-- `status IN ('approved','billed')`, so dropping the value broke every page
-- that reads timesheet hours. It was restored immediately with:
--
--   ALTER TYPE "TimesheetStatus" ADD VALUE IF NOT EXISTS 'billed';
--
-- leaving prod's enum ahead of its own migration history. This file closes
-- that gap on the next deploy.
--
-- SEQUENCING — THIS MUST NOT SHIP IN THE SAME DEPLOY AS THE PHASE 8 CODE.
-- `scripts/vercel-build.mjs` runs `prisma migrate deploy` BEFORE `next build`,
-- so a migration in the same deploy executes while the OLD code is still
-- serving traffic — reproducing exactly the breakage above, just briefly.
-- Merge and deploy Phase 8 first; ship this in a later, separate deploy once
-- the running code no longer references 'billed'.
--
-- No data is touched: nothing has ever been left at 'billed' once TASK-500's
-- backfill ran (it reported zero affected rows on prod).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'TimesheetStatus'
       AND e.enumlabel = 'billed'
  ) THEN
    -- Belt and braces: refuse to run while any row still uses the value,
    -- rather than failing halfway through the type swap below.
    IF EXISTS (SELECT 1 FROM "TimesheetEntry" WHERE "status" = 'billed') THEN
      RAISE EXCEPTION
        'TimesheetEntry rows still have status=billed — resolve them to approved (and set contractorBillId) before dropping the enum value.';
    END IF;

    ALTER TYPE "TimesheetStatus" RENAME TO "TimesheetStatus_old";
    CREATE TYPE "TimesheetStatus" AS ENUM ('draft', 'submitted', 'approved');
    ALTER TABLE "TimesheetEntry" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "TimesheetEntry"
      ALTER COLUMN "status" TYPE "TimesheetStatus"
      USING ("status"::text::"TimesheetStatus");
    ALTER TABLE "TimesheetEntry" ALTER COLUMN "status" SET DEFAULT 'draft';
    DROP TYPE "TimesheetStatus_old";
    RAISE NOTICE 'TimesheetStatus.billed dropped.';
  ELSE
    RAISE NOTICE 'TimesheetStatus.billed already absent — nothing to do.';
  END IF;
END $$;
