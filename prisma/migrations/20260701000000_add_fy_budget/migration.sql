-- Per-FY budget: top-line targets + OPEX plan.
-- Seeded for FY27 from the Vendors & Systems Register in the master
-- tracker; the app supports create/edit going forward.

CREATE TYPE "FyBudgetCadence" AS ENUM ('monthly', 'quarterly', 'annual', 'one_off', 'variable');

CREATE TABLE "FyBudget" (
  "id"                         TEXT PRIMARY KEY,
  "yearEnding"                 INTEGER NOT NULL UNIQUE,
  "revenueTargetCents"         INTEGER NOT NULL DEFAULT 0,
  "consultantCostTargetCents"  INTEGER NOT NULL DEFAULT 0,
  "projectExpenseTargetCents"  INTEGER NOT NULL DEFAULT 0,
  "ebitTargetCents"            INTEGER NOT NULL DEFAULT 0,
  "notes"                      TEXT,
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL
);

CREATE INDEX "FyBudget_yearEnding_idx" ON "FyBudget" ("yearEnding");

CREATE TABLE "FyBudgetOpexLine" (
  "id"                 TEXT PRIMARY KEY,
  "fyBudgetId"         TEXT NOT NULL,
  "label"              TEXT NOT NULL,
  "atoCategory"        TEXT NOT NULL,
  "vendor"             TEXT,
  "plannedAnnualCents" INTEGER NOT NULL DEFAULT 0,
  "isCarryOver"        BOOLEAN NOT NULL DEFAULT false,
  "cadence"            "FyBudgetCadence" NOT NULL DEFAULT 'annual',
  "notes"              TEXT,
  "sortOrder"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FyBudgetOpexLine_fyBudgetId_fkey"
    FOREIGN KEY ("fyBudgetId") REFERENCES "FyBudget"("id") ON DELETE CASCADE
);

CREATE INDEX "FyBudgetOpexLine_fyBudgetId_atoCategory_idx"
  ON "FyBudgetOpexLine" ("fyBudgetId", "atoCategory");
