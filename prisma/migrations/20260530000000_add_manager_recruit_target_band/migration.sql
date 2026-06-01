-- Add 'manager' to the RecruitTargetBand enum so the talent pipeline
-- can track delivery-management hires distinct from individual-
-- contributor consultants. Slots between Fellow and Consultant in
-- TARGET_BAND_ORDER (recruits.ts).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'manager'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'RecruitTargetBand')
  ) THEN
    ALTER TYPE "RecruitTargetBand" ADD VALUE 'manager';
  END IF;
END $$;
