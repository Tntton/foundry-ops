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
