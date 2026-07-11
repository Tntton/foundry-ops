-- Feedback → implementation loop: link a ticket to the commit that
-- resolved it, and track when it was routed to a Claude Code chat.
--
-- Both nullable — no backfill. Existing tickets keep their status;
-- these columns populate as tickets move through the new loop.

ALTER TABLE "FeedbackTicket"
  ADD COLUMN "commitRef" TEXT,
  ADD COLUMN "routedToDevAt" TIMESTAMP(3);
