-- In-app assistant — per-user chat threads + messages.
-- Phase 1 (TASK-300) writes user + assistant rows. tool rows reserved
-- for Phase 2 / Phase 3.

CREATE TYPE "AssistantThreadStatus" AS ENUM ('active', 'archived');
CREATE TYPE "AssistantMessageRole"  AS ENUM ('user', 'assistant', 'tool');

CREATE TABLE "AssistantThread" (
  "id"            TEXT PRIMARY KEY,
  "personId"      TEXT NOT NULL,
  "status"        "AssistantThreadStatus" NOT NULL DEFAULT 'active',
  "lastMessageAt" TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantThread_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE
);

CREATE INDEX "AssistantThread_personId_status_idx"        ON "AssistantThread"("personId", "status");
CREATE INDEX "AssistantThread_personId_lastMessageAt_idx" ON "AssistantThread"("personId", "lastMessageAt");

CREATE TABLE "AssistantMessage" (
  "id"         TEXT PRIMARY KEY,
  "threadId"   TEXT NOT NULL,
  "role"       "AssistantMessageRole" NOT NULL,
  "content"    TEXT NOT NULL,
  "toolName"   TEXT,
  "toolInput"  JSONB,
  "toolOutput" JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AssistantThread"("id") ON DELETE CASCADE
);

CREATE INDEX "AssistantMessage_threadId_createdAt_idx" ON "AssistantMessage"("threadId", "createdAt");
