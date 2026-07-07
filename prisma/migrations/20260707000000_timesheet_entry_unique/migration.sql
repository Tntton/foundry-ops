-- One TimesheetEntry per (personId, projectId, date).
--
-- Duplicates were possible before this (all writers used `create`,
-- deduped only by a read BEFORE the transaction — a TOCTOU window for
-- two tabs / retries / WhatsApp+web double-logging). The grid hid the
-- duplicate (`.find()` per day) while utilisation, P&L and CSV export
-- counted both.
--
-- Step 1: dedupe — keep the most recently updated row per key; prefer
-- the row with the "most progressed" status on ties is not attempted
-- (updatedAt is a good-enough proxy at this data volume).
DELETE FROM "TimesheetEntry" t
USING "TimesheetEntry" k
WHERE t."personId" = k."personId"
  AND t."projectId" = k."projectId"
  AND t."date" = k."date"
  AND t.id <> k.id
  AND (t."updatedAt" < k."updatedAt"
       OR (t."updatedAt" = k."updatedAt" AND t.id < k.id));

-- Step 2: enforce.
CREATE UNIQUE INDEX "TimesheetEntry_personId_projectId_date_key"
  ON "TimesheetEntry" ("personId", "projectId", "date");
