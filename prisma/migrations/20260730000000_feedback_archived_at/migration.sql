-- FeedbackTicket.archivedAt — set when an admin archives a COMPLETED
-- (terminal: resolved/declined/duplicate) ticket. Distinct from the
-- `resolved` status: resolved = the work shipped; archived = TT has seen
-- it and cleared it from the active queue. A terminal ticket with
-- archivedAt IS NULL is "completed, ready to archive" and stays visible
-- in its own lane until archived.

ALTER TABLE "FeedbackTicket"
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "FeedbackTicket_archivedAt_idx"
  ON "FeedbackTicket" ("archivedAt");
