-- Forecast sandbox scenarios (TASK-072). A saved what-if over the firm's
-- book of business; never mutates real project data. `adjustments` holds
-- the per-project overrides as JSON.
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "note" TEXT,
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Scenario_ownerId_updatedAt_idx" ON "Scenario"("ownerId", "updatedAt");
