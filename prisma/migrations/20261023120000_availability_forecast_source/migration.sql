-- Provenance on an availability forecast row (TASK-522).
--
-- The Outlook calendar sync fills days a person has left blank. For that to
-- be repeatable it has to tell its own earlier output apart from something a
-- human typed: Q2 (TT, 2026-10-23) is "fill blanks only, never overwrite a
-- manual forecast", and without provenance the only ways to honour that are
-- to overwrite everything or to never refresh a synced day once written.
--
-- Default `human` is correct for every existing row — until this ships the
-- only writer is /availability, whether the person edited their own forecast
-- or an admin did it on their behalf. Saving over a synced day in the editor
-- flips the row back to `human`, which pins it from future syncs.
CREATE TYPE "AvailabilitySource" AS ENUM ('human', 'outlook');

ALTER TABLE "AvailabilityForecast"
  ADD COLUMN "source" "AvailabilitySource" NOT NULL DEFAULT 'human';
