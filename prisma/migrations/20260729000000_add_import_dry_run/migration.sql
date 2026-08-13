-- Shared dry-run cache for the two-step bulk-import flow.
--
-- Replaces a per-process in-memory Map that silently failed on Vercel:
-- the parse request and the Commit request are separate serverless
-- invocations and can land on different instances, so the Commit could
-- not find the stashed preview and the operator saw "preview expired or
-- already committed". A table is shared across instances, fixing every
-- import surface (personnel, timesheets, bills, expenses).
CREATE TABLE "ImportDryRun" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportDryRun_pkey" PRIMARY KEY ("token")
);

-- Supports opportunistic GC of expired rows.
CREATE INDEX "ImportDryRun_expiresAt_idx" ON "ImportDryRun"("expiresAt");
