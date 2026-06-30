-- ContractorInvoice — historical aggregated contractor cost ingested
-- from the FY26 master tracker. Feeds project P&L alongside the live
-- TimesheetEntry bucket. No FK to a real Invoice row — TT 2026-06-30
-- call is "history is reorganised later if invoice-level needed".

CREATE TABLE "ContractorInvoice" (
  "id"            TEXT PRIMARY KEY,
  "personId"      TEXT NOT NULL,
  "projectId"     TEXT NOT NULL,
  "hours"         DECIMAL(8, 2) NOT NULL,
  "amountExGst"   INTEGER NOT NULL,
  "gst"           INTEGER NOT NULL DEFAULT 0,
  "periodLabel"   TEXT NOT NULL,
  "periodAnchor"  DATE NOT NULL,
  "roleOnInvoice" TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractorInvoice_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT,
  CONSTRAINT "ContractorInvoice_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT
);

CREATE INDEX "ContractorInvoice_projectId_periodAnchor_idx"
  ON "ContractorInvoice" ("projectId", "periodAnchor");
CREATE INDEX "ContractorInvoice_personId_periodAnchor_idx"
  ON "ContractorInvoice" ("personId", "periodAnchor");
