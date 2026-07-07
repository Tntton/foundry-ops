-- AvailabilityForecast.projectId — optional FK to Project so each per-day
-- forecast cell can be earmarked against a specific project code, or
-- left null to mean "unallocated" (available for future allocation).
--
-- SetNull on delete so archiving/deleting a project doesn't take
-- forecast rows with it - the hours are still forecast, they just
-- become unallocated automatically.

ALTER TABLE "AvailabilityForecast"
  ADD COLUMN "projectId" TEXT;

ALTER TABLE "AvailabilityForecast"
  ADD CONSTRAINT "AvailabilityForecast_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "AvailabilityForecast_projectId_idx"
  ON "AvailabilityForecast" ("projectId");
