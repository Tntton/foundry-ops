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
