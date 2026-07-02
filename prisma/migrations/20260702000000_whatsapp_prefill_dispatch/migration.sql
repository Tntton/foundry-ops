-- Dispatch log for WhatsApp prefill deep-links (TASK-128). Powers the
-- completion-reminder cron. No FK to Person (keyed by personId, same as
-- the audit trail). Reply-to-confirm is deferred to a later task.

CREATE TABLE "WhatsAppPrefillDispatch" (
  "id"                 TEXT PRIMARY KEY,
  "personId"           TEXT NOT NULL,
  "whatsappNumber"     TEXT NOT NULL,
  "kind"               TEXT NOT NULL,
  "linkUrl"            TEXT NOT NULL,
  "jti"                TEXT NOT NULL,
  "projectCode"        TEXT,
  "entryDateIso"       TEXT,
  "hours"              DECIMAL(6,2),
  "amountCents"        BIGINT,
  "sentAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"          TIMESTAMP(3) NOT NULL,
  "completedAt"        TIMESTAMP(3),
  "earlyReminderAt"    TIMESTAMP(3),
  "lastCallReminderAt" TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "WhatsAppPrefillDispatch_jti_key" ON "WhatsAppPrefillDispatch" ("jti");
CREATE INDEX "WhatsAppPrefillDispatch_completedAt_expiresAt_idx" ON "WhatsAppPrefillDispatch" ("completedAt", "expiresAt");
CREATE INDEX "WhatsAppPrefillDispatch_personId_completedAt_idx" ON "WhatsAppPrefillDispatch" ("personId", "completedAt");
