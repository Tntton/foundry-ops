-- ============================================================================
-- Foundry Ops — BACKFILL: three migrations that never reached production.
--
-- Found 2026-09-06 while verifying the Phase 8 deploy. These landed in the
-- repo in late July but were never applied to prod, so three features have
-- been throwing P2021 (table does not exist) since then:
--   ImportDryRun  -> admin CSV bulk-import preview
--   Invoice cols  -> tax-invoice PDF archiving to SharePoint
--   Scenario      -> forecast sandbox
--
-- SQL is verbatim from the migration files — deliberately NOT guarded with
-- IF NOT EXISTS. We verified none of these objects exist; if any DO exist,
-- this should fail loudly and roll back rather than silently half-apply.
--
-- One transaction: it either fully applies or changes nothing. Safe to re-run.
-- ============================================================================

BEGIN;

-- ─── 20260729000000_add_import_dry_run ───
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

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES
  (gen_random_uuid()::text, 'ed18bcc898d2563d23cc841d6dc602e64d67ea08d33919b302e96444a001e37d', now(), '20260729000000_add_import_dry_run', NULL, NULL, now(), 1)
ON CONFLICT DO NOTHING;

-- ─── 20260731000000_add_invoice_sharepoint_pointer ───
-- Archive finalised tax-invoice PDFs to SharePoint (TASK-068).
--
-- The app is the identity/record master but stores only pointers to
-- files in SharePoint, never binary content (A3). These two columns
-- hold the browser-openable webUrl and the Graph DriveItem id for the
-- rendered tax-invoice PDF, populated the first time an invoice is
-- finalised while Graph is configured. Both nullable so historical
-- invoices (and any finalised while Graph was unreachable) render fine
-- without a value; the finalise action retries the upload on the next
-- call until the URL is set.
ALTER TABLE "Invoice" ADD COLUMN "taxInvoiceSharepointUrl" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "taxInvoiceDriveItemId" TEXT;

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES
  (gen_random_uuid()::text, 'b9d87e592f4509a6f89e14df30d9a0452f0cc7ceda6ab67d38b64895ec55dfdd', now(), '20260731000000_add_invoice_sharepoint_pointer', NULL, NULL, now(), 1)
ON CONFLICT DO NOTHING;

-- ─── 20260731100000_add_scenario ───
-- Forecast sandbox scenarios (TASK-072). A saved what-if over the firm's
-- book of business; never mutates real project data. `adjustments` holds
-- the per-project overrides as JSON.
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "note" TEXT,
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    -- Hypothetical (not-yet-real) projects modelled in the scenario.
    "hypotheticals" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Scenario_ownerId_updatedAt_idx" ON "Scenario"("ownerId", "updatedAt");

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES
  (gen_random_uuid()::text, 'f86b70e0d977f60e83e885c334f2f8342323a7a2a699214cbfc36660579ee79e', now(), '20260731100000_add_scenario', NULL, NULL, now(), 1)
ON CONFLICT DO NOTHING;

COMMIT;

-- Verify: all three should come back non-null / 2.
select to_regclass('public."ImportDryRun"') as import_dry_run_table,
       to_regclass('public."Scenario"')     as scenario_table,
       (select count(*) from information_schema.columns
         where table_name = 'Invoice'
           and column_name in ('taxInvoiceSharepointUrl','taxInvoiceDriveItemId')) as invoice_cols;
