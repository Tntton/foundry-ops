-- Reconcile assistant (super-admin) gets its own thread namespace so it
-- doesn't mix history with the general in-app helper at /assistant.

CREATE TYPE "AssistantThreadKind" AS ENUM ('general', 'reconcile');

ALTER TABLE "AssistantThread"
  ADD COLUMN "kind" "AssistantThreadKind" NOT NULL DEFAULT 'general';

-- New composite index covering the (personId, kind, status) lookup the
-- action layer uses to find the active thread for a given assistant.
DROP INDEX IF EXISTS "AssistantThread_personId_status_idx";
CREATE INDEX "AssistantThread_personId_kind_status_idx"
  ON "AssistantThread" ("personId", "kind", "status");
