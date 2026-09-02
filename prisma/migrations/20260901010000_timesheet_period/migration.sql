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
