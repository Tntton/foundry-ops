-- InvoiceLine.projectId — optional FK to Project (feedback #12B, "Option C":
-- invoices that span multiple project codes for one client). Null means the
-- line belongs to the invoice's primary project (Invoice.projectId) — the
-- pre-#12B behaviour and the default for single-project invoices. When set,
-- the line is attributed to this project instead (revenue reports read line
-- project when present, else the invoice header).
--
-- SetNull on delete so archiving/deleting a project frees the line back to
-- the invoice's header project rather than orphaning it.

ALTER TABLE "InvoiceLine"
  ADD COLUMN "projectId" TEXT;

ALTER TABLE "InvoiceLine"
  ADD CONSTRAINT "InvoiceLine_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "InvoiceLine_projectId_idx"
  ON "InvoiceLine" ("projectId");
