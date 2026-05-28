-- DocuSign — e-signature pipeline.
-- One row per envelope (signature ceremony). Status mirrors
-- DocuSign's REST API states; populated by the Connect webhook.
CREATE TYPE "EnvelopeStatus" AS ENUM (
  'created',
  'sent',
  'delivered',
  'completed',
  'declined',
  'voided'
);

CREATE TABLE "DocuSignEnvelope" (
  "id"                     TEXT PRIMARY KEY,
  "externalEnvelopeId"     TEXT NOT NULL UNIQUE,
  "subjectType"            TEXT NOT NULL,
  "subjectId"              TEXT NOT NULL,
  "status"                 "EnvelopeStatus" NOT NULL DEFAULT 'created',
  "emailSubject"           TEXT,
  "recipients"             JSONB NOT NULL,
  "signedDocSharepointUrl" TEXT,
  "senderId"               TEXT NOT NULL,
  "sentAt"                 TIMESTAMP(3),
  "completedAt"            TIMESTAMP(3),
  "message"                TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DocuSignEnvelope_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "DocuSignEnvelope_subjectType_subjectId_idx" ON "DocuSignEnvelope"("subjectType", "subjectId");
CREATE INDEX "DocuSignEnvelope_status_idx" ON "DocuSignEnvelope"("status");
CREATE INDEX "DocuSignEnvelope_senderId_idx" ON "DocuSignEnvelope"("senderId");
