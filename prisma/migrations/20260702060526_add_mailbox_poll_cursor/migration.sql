-- TASK-093 · AP autoharvest — mailbox poll cursors
--
-- One row per M365 mailbox polled by /api/cron/invoice-autoharvest.
-- Not backed by the generic Integration model because two mailboxes
-- are polled concurrently (finance@ + trung@) and one IntegrationKind
-- row per kind wouldn't fit. See INTEGRATIONS.md §7 for the full flow.

-- CreateTable
CREATE TABLE "MailboxPollCursor" (
    "id" TEXT NOT NULL,
    "mailboxUpn" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastReceivedDateTime" TIMESTAMP(3),
    "lastPollAt" TIMESTAMP(3),
    "lastError" TEXT,
    "actorPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxPollCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailboxPollCursor_mailboxUpn_key" ON "MailboxPollCursor"("mailboxUpn");

-- AddForeignKey
ALTER TABLE "MailboxPollCursor" ADD CONSTRAINT "MailboxPollCursor_actorPersonId_fkey" FOREIGN KEY ("actorPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
