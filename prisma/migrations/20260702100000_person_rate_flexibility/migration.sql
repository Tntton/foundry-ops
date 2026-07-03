-- Person rate flexibility: sticky manual override, expert-tier second rate,
-- optional agency markup for fully-loaded contractor cost.
--
-- All columns nullable / defaulted so this migration is safe against a
-- populated Person table (no backfill needed). Downstream cost calcs
-- opt into the new fields via `loadedCostCents()`; existing consumers
-- continue reading `person.rate` unchanged.

ALTER TABLE "Person"
  ADD COLUMN "rateOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "expertRate" INTEGER,
  ADD COLUMN "expertRateUnit" "RateUnit",
  ADD COLUMN "agencyName" TEXT,
  ADD COLUMN "agencyMarkupPct" DECIMAL(5, 2);
