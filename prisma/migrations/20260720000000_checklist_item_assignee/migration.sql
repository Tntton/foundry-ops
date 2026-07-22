-- Checklist item ownership: who is on the hook for each item.
--
-- Nullable, no backfill — existing items stay unassigned. Kept as a bare
-- string id (no FK) to match the sibling `doneById` column; the app
-- resolves the Person for display, like Risk.ownerId does.

ALTER TABLE "ProjectChecklistItem"
  ADD COLUMN "assigneeId" TEXT;

CREATE INDEX "ProjectChecklistItem_assigneeId_idx"
  ON "ProjectChecklistItem"("assigneeId");
