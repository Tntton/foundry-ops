-- Onboarding tour dismissal timestamp on Person.
--
-- Null = tour has never shown. Set on first sign-in when the user
-- clicks "Finish" or "Skip" in the first-login role-scoped guide.

ALTER TABLE "Person"
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
