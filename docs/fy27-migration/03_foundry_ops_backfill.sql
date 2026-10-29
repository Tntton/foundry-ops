-- ===========================================================================
-- Foundry Ops : backfill of existing people into the FY27 model
-- File 3 of 4 : migration
--
-- READ FIRST. This file cannot be run blind. It reads from a staging table
-- that YOU populate from the current platform. Step M2 below is the only
-- place that touches the legacy system, and it is a SELECT.
--
-- Everything here is INSERT-only. No legacy row is modified or deleted.
-- ===========================================================================

BEGIN;
SET search_path TO foundry, public;

-- ---------------------------------------------------------------------------
-- M1. Staging table. One row per person currently known to the platform.
--     Populate from the legacy tables, then run the rest of this file.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stg_legacy_personnel (
  legacy_ref        text PRIMARY KEY,   -- id or initials in the current system
  full_name         text NOT NULL,
  preferred_name    text,
  work_email        text,
  legacy_role_label text NOT NULL,      -- exactly as held today, e.g. 'Associate Partner (L2)'
  legacy_source     text NOT NULL,      -- '2025_position_description' | 'fy23_24_rate_card' | 'platform' | 'offer_letter'
  role_start_date   date,               -- start in CURRENT role; drives the tenure clock
  engagement_type   text,               -- 'permanent' | 'contractor' | 'program' | 'honorary'; NULL = needs review
  employment_basis  text,               -- 'full_time' | 'part_time'; permanent only
  fte_fraction      numeric(4,3),       -- permanent only; 1.000 for full time
  geo               text DEFAULT 'AU',
  currency          char(3) DEFAULT 'AUD',
  current_cost_hr   numeric(10,2),      -- contractor rate in force today
  base_salary_fulltime numeric(12,2),   -- permanent only, at 1.0 FTE
  is_active         boolean DEFAULT true,
  notes             text
);

-- ---------------------------------------------------------------------------
-- M2. PREFLIGHT. All three must return zero rows before proceeding.
-- ---------------------------------------------------------------------------
-- (a) Legacy labels that do not resolve to a canonical code, either because
--     there is no mapping or because the mapping is flagged for review:
--     SELECT s.legacy_ref, s.legacy_role_label, s.legacy_source, m.review_note
--     FROM stg_legacy_personnel s
--     LEFT JOIN ref_role_code_map m ON m.legacy_label = s.legacy_role_label
--                                  AND m.legacy_source = s.legacy_source
--     WHERE m.canonical_role_code IS NULL;
--
-- (b) People with no engagement type. Permanent vs contractor cannot be guessed;
--     the distinction carries legal consequences. Resolve with the MP:
--     SELECT legacy_ref, full_name FROM stg_legacy_personnel WHERE engagement_type IS NULL;
--
-- (c) Permanent people with no FTE:
--     SELECT legacy_ref FROM stg_legacy_personnel
--     WHERE engagement_type='permanent' AND (employment_basis IS NULL OR fte_fraction IS NULL);

-- ---------------------------------------------------------------------------
-- M3. Create person identities.
-- ---------------------------------------------------------------------------
INSERT INTO person (legacy_ref, full_name, preferred_name, work_email)
SELECT s.legacy_ref, s.full_name, s.preferred_name, s.work_email
FROM stg_legacy_personnel s
ON CONFLICT (legacy_ref) DO NOTHING;

-- ---------------------------------------------------------------------------
-- M4. Role, mapped through the deprecation table.
--     effective_from is the person's real start date in that role, so the
--     tenure clock keeps history rather than restarting at go-live.
-- ---------------------------------------------------------------------------
INSERT INTO person_role (person_id, effective_from, role_code, change_reason, approved_by, evidence_ref)
SELECT p.person_id,
       COALESCE(s.role_start_date, DATE '2026-07-01'),
       m.canonical_role_code,
       'migration',
       'MP',
       'FY27 role architecture migration'
FROM stg_legacy_personnel s
JOIN person p ON p.legacy_ref = s.legacy_ref
JOIN ref_role_code_map m ON m.legacy_label = s.legacy_role_label
                        AND m.legacy_source = s.legacy_source
                        AND m.canonical_role_code IS NOT NULL
ON CONFLICT (person_id, effective_from) DO NOTHING;

-- ---------------------------------------------------------------------------
-- M5. Engagement. This is where full-time, part-time and pool contractor
--     become first-class data rather than an inference from job title.
-- ---------------------------------------------------------------------------
INSERT INTO person_engagement (person_id, effective_from, engagement_type,
       employment_basis, fte_fraction, change_reason, approved_by)
SELECT p.person_id,
       COALESCE(s.role_start_date, DATE '2026-07-01'),
       s.engagement_type,
       CASE WHEN s.engagement_type = 'permanent' THEN s.employment_basis END,
       CASE WHEN s.engagement_type = 'permanent' THEN s.fte_fraction END,
       'migration', 'MP'
FROM stg_legacy_personnel s
JOIN person p ON p.legacy_ref = s.legacy_ref
WHERE s.engagement_type IS NOT NULL
ON CONFLICT (person_id, effective_from) DO NOTHING;

-- ---------------------------------------------------------------------------
-- M6. Status. Everyone present at go-live starts Active; anyone flagged
--     inactive in the legacy system becomes Alumni pending MP review, because
--     Reserve is a positive election and must not be assumed on someone's behalf.
-- ---------------------------------------------------------------------------
INSERT INTO person_status (person_id, effective_from, status_code, reason, approved_by)
SELECT p.person_id,
       COALESCE(s.role_start_date, DATE '2026-07-01'),
       CASE WHEN s.is_active THEN 'ACTIVE' ELSE 'ALUMNI' END,
       'migration', 'MP'
FROM stg_legacy_personnel s
JOIN person p ON p.legacy_ref = s.legacy_ref
ON CONFLICT (person_id, effective_from) DO NOTHING;

-- ---------------------------------------------------------------------------
-- M7. Talent pool, derived from role code.
-- ---------------------------------------------------------------------------
INSERT INTO person_pool (person_id, effective_from, pool_code)
SELECT DISTINCT ON (p.person_id)
       p.person_id, DATE '2026-07-01', pr.pool_code
FROM stg_legacy_personnel s
JOIN person p ON p.legacy_ref = s.legacy_ref
JOIN ref_role_code_map m ON m.legacy_label = s.legacy_role_label AND m.legacy_source = s.legacy_source AND m.canonical_role_code IS NOT NULL
JOIN ref_pool_role pr ON pr.role_code = m.canonical_role_code
ORDER BY p.person_id, pr.effective_from DESC
ON CONFLICT (person_id, effective_from) DO NOTHING;

-- ---------------------------------------------------------------------------
-- M8. RATES: the no-worse-off pass.
--
--   above anchor -> preserve the existing rate as a personal, grandfathered
--                   rate. It carries into subsequent work orders unless varied
--                   by agreement.
--   at anchor    -> record as band_anchor.
--   below anchor -> record the CURRENT rate unchanged and flag for MP review.
--                   Deliberately no automatic uplift: raising everyone below
--                   anchor is a cost decision for the MP, not a migration side
--                   effect. See open decision OD-1 in the brief.
-- ---------------------------------------------------------------------------
INSERT INTO person_rate (person_id, effective_from, geo, currency, cost_hr,
       rate_basis, deviation_reason, approved_by)
SELECT p.person_id, DATE '2026-07-01', s.geo, s.currency, s.current_cost_hr,
       CASE WHEN rb.cost_hr IS NULL            THEN 'negotiated_in_band'
            WHEN s.current_cost_hr > rb.cost_hr THEN 'grandfathered'
            WHEN s.current_cost_hr < rb.cost_hr THEN 'deviation_below'
            ELSE 'band_anchor' END,
       CASE WHEN rb.cost_hr IS NULL            THEN NULL
            WHEN s.current_cost_hr > rb.cost_hr THEN 'No worse off: rate in force at FY27 transition preserved as a personal rate'
            WHEN s.current_cost_hr < rb.cost_hr THEN 'Below FY27 anchor at transition; flagged for MP review at next work order'
            END,
       'MP'
FROM stg_legacy_personnel s
JOIN person p ON p.legacy_ref = s.legacy_ref
JOIN ref_role_code_map m ON m.legacy_label = s.legacy_role_label AND m.legacy_source = s.legacy_source AND m.canonical_role_code IS NOT NULL
LEFT JOIN LATERAL (
  SELECT cost_hr FROM ref_rate_band rb2
  WHERE rb2.role_code = m.canonical_role_code AND rb2.geo = s.geo
    AND rb2.effective_from <= DATE '2026-07-01'
  ORDER BY rb2.effective_from DESC LIMIT 1) rb ON true
WHERE s.engagement_type = 'contractor' AND s.current_cost_hr IS NOT NULL
ON CONFLICT (person_id, geo, effective_from) DO NOTHING;

-- ---------------------------------------------------------------------------
-- M9. Salaries for permanent staff. Always stored at the 1.0 FTE figure;
--     the actual payment is derived as base_salary_fulltime * fte_fraction,
--     so a move between full time and part time never rewrites the salary.
-- ---------------------------------------------------------------------------
INSERT INTO person_remuneration (person_id, effective_from, currency,
       base_salary_fulltime, approved_by)
SELECT p.person_id, DATE '2026-07-01', s.currency, s.base_salary_fulltime, 'MP'
FROM stg_legacy_personnel s
JOIN person p ON p.legacy_ref = s.legacy_ref
WHERE s.engagement_type = 'permanent' AND s.base_salary_fulltime IS NOT NULL
ON CONFLICT (person_id, effective_from) DO NOTHING;

COMMIT;
