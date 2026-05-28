-- Add the Support_Staff band for non-delivery firm roles (Office Manager
-- being the canonical example — Jas Navarro). Support staff don't sit on
-- the consulting pyramid (Partner / Expert / Consultant / Analyst) and
-- their hours don't roll into utilisation or billable capacity, so the
-- band acts as the exclusion gate in resource-planning / availability /
-- manager-dashboard maths.
ALTER TYPE "Band" ADD VALUE 'Support_Staff';
