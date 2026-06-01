-- Lessons-learned / strategic takeaway field on Deal. Used by the
-- BD outcomes review page (/bd/outcomes) for both lost-deal post-
-- mortems and won-deal pattern recognition.
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "lessonsLearned" TEXT;
