-- In-app feedback / feature-request / bug-report tickets.
CREATE TYPE "FeedbackUrgency" AS ENUM ('critical', 'urgent', 'routine');
CREATE TYPE "FeedbackKind" AS ENUM ('bug', 'feature', 'maintenance', 'other');
CREATE TYPE "FeedbackStatus" AS ENUM ('open', 'triaged', 'approved', 'in_progress', 'resolved', 'declined', 'duplicate');

CREATE TABLE "FeedbackTicket" (
  "id"          TEXT PRIMARY KEY,
  "submitterId" TEXT NOT NULL,
  "urgency"     "FeedbackUrgency" NOT NULL,
  "kind"        "FeedbackKind"    NOT NULL DEFAULT 'other',
  "title"       TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "contextPath" TEXT,
  "status"      "FeedbackStatus"  NOT NULL DEFAULT 'open',
  "triageNotes" TEXT,
  "decidedAt"   TIMESTAMP(3),
  "decidedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeedbackTicket_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "Person"("id") ON DELETE RESTRICT,
  CONSTRAINT "FeedbackTicket_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Person"("id") ON DELETE SET NULL
);

CREATE INDEX "FeedbackTicket_status_urgency_idx" ON "FeedbackTicket"("status", "urgency");
CREATE INDEX "FeedbackTicket_submitterId_idx" ON "FeedbackTicket"("submitterId");
