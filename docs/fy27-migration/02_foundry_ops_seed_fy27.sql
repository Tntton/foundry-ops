-- ===========================================================================
-- Foundry Ops : FY27 reference data
-- File 2 of 4 : seed (GENERATED - do not hand-edit)
-- Generated from : ../foundry_roles_schema.json   schema version 2.3-draft
-- Effective from : 2026-07-01
--
-- Re-runnable. Inserts are effective-dated, so re-running with a newer
-- schema version ADDS rows rather than replacing them, per append-only.
-- ===========================================================================

BEGIN;
SET search_path TO foundry, public;

-- Billing multiples (bill rates are derived from cost, never stored)
INSERT INTO ref_billing_multiple (bill_low_multiple, bill_high_multiple, effective_from, schema_version)
VALUES (2.0, 3.0, '2026-07-01', '2.3-draft')
ON CONFLICT (effective_from) DO NOTHING;

-- Bands
INSERT INTO ref_band (band_code, band_name, notes, effective_from, schema_version) VALUES
  ('PARTNERSHIP', 'Partnership', 'Outside the L-track. Entry by invitation and consensus of partners; fiduciary role.', '2026-07-01', '2.3-draft'),
  ('LEADERSHIP', 'Leadership', NULL, '2026-07-01', '2.3-draft'),
  ('CONSULTANT', 'Consultant', NULL, '2026-07-01', '2.3-draft'),
  ('ANALYST', 'Analyst', NULL, '2026-07-01', '2.3-draft'),
  ('ADVISOR', 'Advisor', 'Contractor or honorary. Periodic strategic guidance; no delivery obligation, no progression mechanics.', '2026-07-01', '2.3-draft'),
  ('EXPERT', 'Expert', 'Contractor-only rail. Permanent entry requires joining the core consulting ladder.', '2026-07-01', '2.3-draft'),
  ('FELLOW', 'Fellow', 'Contractor-only rail. Clinical SMEs building consulting exposure.', '2026-07-01', '2.3-draft'),
  ('INTERN', 'Intern', NULL, '2026-07-01', '2.3-draft')
ON CONFLICT (band_code, effective_from) DO NOTHING;

-- Roles
INSERT INTO ref_role (role_code, title, band_code, seniority_rank, dual_pathway,
  permits_permanent, permits_contractor, permits_program, permits_honorary,
  remuneration_model, incentive_target_pct, notes, effective_from, schema_version) VALUES
  ('MP', 'Managing Partner', 'PARTNERSHIP', 100, false, true, false, false, false, 'salary_plus_time_billing_plus_LT_share_plus_partnership_distribution', NULL, 'Only salaried role in the firm (salaried partner role), received in addition to the standard partner package of time billing + LT share + partnership distribution. CEO-equivalent: day-to-day oversight, P&L responsibility, admin team leadership, rate/PD sign-off authority.', '2026-07-01', '2.3-draft'),
  ('P1', 'Partner', 'PARTNERSHIP', 90, false, true, false, false, false, 'time_billing_plus_LT_share_plus_partnership_distribution', NULL, 'Equity owner; fiduciary responsibility. Remunerated via time billing + LT share + partnership distribution; no fixed internal cost rate. Bill rates apply for engagement pricing.', '2026-07-01', '2.3-draft'),
  ('L3', 'Associate Partner / Director', 'LEADERSHIP', 80, true, true, true, false, false, 'dual_rem_time_billing_plus_LT_share', 25, 'Dual remuneration: time billing + long-term share, per platform row effective 2026-05-21. Dual pathway: career AP or Partner track.', '2026-07-01', '2.3-draft'),
  ('L2', 'Senior Manager / Project Director', 'LEADERSHIP', 70, true, true, true, false, false, 'hourly_or_salary', 20, NULL, '2026-07-01', '2.3-draft'),
  ('L1', 'Manager / Project Manager', 'LEADERSHIP', 60, true, true, true, false, false, 'hourly_or_salary', 20, NULL, '2026-07-01', '2.3-draft'),
  ('ADV', 'Advisor', 'ADVISOR', 58, false, false, true, false, true, 'honorarium_or_nil_individually_approved', NULL, 'Senior industry leader and supporter of Foundry''s mission and team. Provides periodic strategic guidance to the partnership, supports senior stakeholder relationship management, and mentors emerging talent. Not a delivery role; not time-billed by default. Common destination for senior Alumni.', '2026-07-01', '2.3-draft'),
  ('E2', 'Senior Expert', 'EXPERT', 55, false, false, true, false, false, 'hourly', NULL, NULL, '2026-07-01', '2.3-draft'),
  ('E1', 'Expert', 'EXPERT', 50, false, false, true, false, false, 'hourly', NULL, NULL, '2026-07-01', '2.3-draft'),
  ('F2', 'Fellow', 'FELLOW', 45, false, false, true, false, false, 'hourly', NULL, NULL, '2026-07-01', '2.3-draft'),
  ('F1', 'Junior Fellow', 'FELLOW', 40, false, false, true, false, false, 'hourly', NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T3', 'Senior Consultant', 'CONSULTANT', 35, true, true, true, false, false, 'hourly_or_salary', 15, NULL, '2026-07-01', '2.3-draft'),
  ('T2', 'Consultant', 'CONSULTANT', 30, true, true, true, false, false, 'hourly_or_salary', 15, NULL, '2026-07-01', '2.3-draft'),
  ('T1', 'Junior Consultant', 'CONSULTANT', 25, true, true, true, false, false, 'hourly_or_salary', 15, NULL, '2026-07-01', '2.3-draft'),
  ('A3', 'Senior Analyst', 'ANALYST', 20, true, true, true, false, false, 'hourly_or_salary', 10, NULL, '2026-07-01', '2.3-draft'),
  ('A2', 'Analyst', 'ANALYST', 15, true, true, true, false, false, 'hourly_or_salary', 10, NULL, '2026-07-01', '2.3-draft'),
  ('A1', 'Junior Analyst', 'ANALYST', 10, true, true, true, false, false, 'hourly_or_salary', 10, 'Probationary grade, 6-12 months.', '2026-07-01', '2.3-draft'),
  ('I0', 'Intern', 'INTERN', 5, true, false, false, true, false, 'unpaid_program', NULL, 'Structured program placement; pathway to A1 on merit.', '2026-07-01', '2.3-draft')
ON CONFLICT (role_code, effective_from) DO NOTHING;

-- Rate bands by geography. AU and NZ share the AUD anchor;
-- US and UK are local-market rates derived from the multipliers in schema meta.
INSERT INTO ref_rate_band (role_code, geo, currency, rate_basis, cost_hr,
  bill_low_override, bill_high_override, effective_from, schema_version) VALUES
  ('MP', 'AU', 'AUD', 'bill_override', NULL, 550, 800, '2026-07-01', '2.3-draft'),
  ('MP', 'NZ', 'AUD', 'bill_override', NULL, 550, 800, '2026-07-01', '2.3-draft'),
  ('P1', 'AU', 'AUD', 'bill_override', NULL, 550, 800, '2026-07-01', '2.3-draft'),
  ('P1', 'NZ', 'AUD', 'bill_override', NULL, 550, 800, '2026-07-01', '2.3-draft'),
  ('L3', 'AU', 'AUD', 'bill_override', NULL, 450, 650, '2026-07-01', '2.3-draft'),
  ('L3', 'NZ', 'AUD', 'bill_override', NULL, 450, 650, '2026-07-01', '2.3-draft'),
  ('L2', 'AU', 'AUD', 'cost_derived', 210, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('L2', 'NZ', 'AUD', 'cost_derived', 210, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('L2', 'US', 'USD', 'cost_derived', 139, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('L2', 'UK', 'GBP', 'cost_derived', 105, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('L1', 'AU', 'AUD', 'cost_derived', 190, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('L1', 'NZ', 'AUD', 'cost_derived', 190, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('L1', 'US', 'USD', 'cost_derived', 125, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('L1', 'UK', 'GBP', 'cost_derived', 95, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('ADV', 'AU', 'AUD', 'not_time_billed', NULL, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('ADV', 'NZ', 'AUD', 'not_time_billed', NULL, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('E2', 'AU', 'AUD', 'cost_derived', 315, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('E2', 'NZ', 'AUD', 'cost_derived', 315, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('E2', 'US', 'USD', 'cost_derived', 208, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('E2', 'UK', 'GBP', 'cost_derived', 158, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('E1', 'AU', 'AUD', 'cost_derived', 210, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('E1', 'NZ', 'AUD', 'cost_derived', 210, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('E1', 'US', 'USD', 'cost_derived', 139, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('E1', 'UK', 'GBP', 'cost_derived', 105, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('F2', 'AU', 'AUD', 'cost_derived', 160, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('F2', 'NZ', 'AUD', 'cost_derived', 160, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('F2', 'US', 'USD', 'cost_derived', 106, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('F2', 'UK', 'GBP', 'cost_derived', 80, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('F1', 'AU', 'AUD', 'cost_derived', 125, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('F1', 'NZ', 'AUD', 'cost_derived', 125, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('F1', 'US', 'USD', 'cost_derived', 82, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('F1', 'UK', 'GBP', 'cost_derived', 62, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T3', 'AU', 'AUD', 'cost_derived', 160, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T3', 'NZ', 'AUD', 'cost_derived', 160, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T3', 'US', 'USD', 'cost_derived', 106, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T3', 'UK', 'GBP', 'cost_derived', 80, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T2', 'AU', 'AUD', 'cost_derived', 125, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T2', 'NZ', 'AUD', 'cost_derived', 125, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T2', 'US', 'USD', 'cost_derived', 82, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T2', 'UK', 'GBP', 'cost_derived', 62, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T1', 'AU', 'AUD', 'cost_derived', 85, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T1', 'NZ', 'AUD', 'cost_derived', 85, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T1', 'US', 'USD', 'cost_derived', 56, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('T1', 'UK', 'GBP', 'cost_derived', 42, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A3', 'AU', 'AUD', 'cost_derived', 70, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A3', 'NZ', 'AUD', 'cost_derived', 70, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A3', 'US', 'USD', 'cost_derived', 46, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A3', 'UK', 'GBP', 'cost_derived', 35, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A2', 'AU', 'AUD', 'cost_derived', 55, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A2', 'NZ', 'AUD', 'cost_derived', 55, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A2', 'US', 'USD', 'cost_derived', 36, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A2', 'UK', 'GBP', 'cost_derived', 28, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A1', 'AU', 'AUD', 'cost_derived', 50, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A1', 'NZ', 'AUD', 'cost_derived', 50, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A1', 'US', 'USD', 'cost_derived', 33, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('A1', 'UK', 'GBP', 'cost_derived', 25, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('I0', 'AU', 'AUD', 'cost_derived', 0, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('I0', 'NZ', 'AUD', 'cost_derived', 0, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('I0', 'US', 'USD', 'cost_derived', 0, NULL, NULL, '2026-07-01', '2.3-draft'),
  ('I0', 'UK', 'GBP', 'cost_derived', 0, NULL, NULL, '2026-07-01', '2.3-draft')
ON CONFLICT (role_code, geo, effective_from) DO NOTHING;

-- Workforce statuses. clock_accrues drives the tenure calculation.
INSERT INTO ref_workforce_status (status_code, status_name, clock_accrues, systems_access,
  description, effective_from, schema_version) VALUES
  ('ACTIVE', 'Active', true, true, 'Currently engaged as a permanent employee or under a live contractor work order.', '2026-07-01', '2.3-draft'),
  ('RESERVE', 'Inactive (Reserve)', false, false, 'Self-nominated or mutually agreed pause, colloquially ''shelved''. Used where an individual steps away for another role, clinical training, fellowship, study, parental leave or personal reasons, with the intention or option of returning. Reviewable, nominally up to 24 months.', '2026-07-01', '2.3-draft'),
  ('ALUMNI', 'Alumni', false, false, 'Formally exited with no current expectation of return, on good terms. Not a lesser status: alumni are a deliberate part of Foundry''s network and referral base.', '2026-07-01', '2.3-draft'),
  ('ADVISOR', 'Advisor', false, false, 'Held concurrently with the ADV role code. Senior industry figures, including senior alumni, providing periodic strategic guidance.', '2026-07-01', '2.3-draft')
ON CONFLICT (status_code, effective_from) DO NOTHING;

-- Permanent-track promotion steps. Contractor progression is credential-driven
-- and has no tenure rule, so no contractor rows are seeded.
INSERT INTO ref_promotion_step (from_role_code, to_role_code, track, min_months,
  typical_min_months, typical_max_months, max_months, understudy_required,
  qualification_gate, business_need_gate, effective_from, schema_version) VALUES
  ('I0', 'A1', 'permanent', 3, 3, 6, 12, false, 'Program completion; merit offer', false, '2026-07-01', '2.3-draft'),
  ('A1', 'A2', 'permanent', 6, 6, 12, 18, false, 'None beyond role attributes', false, '2026-07-01', '2.3-draft'),
  ('A2', 'A3', 'permanent', 12, 12, 18, 30, false, 'None; MD candidacy progression supportive', false, '2026-07-01', '2.3-draft'),
  ('A3', 'T1', 'permanent', 12, 18, 24, 36, true, 'Degree completion (MD/MBBS or equivalent) or demonstrated consultant-level capability', false, '2026-07-01', '2.3-draft'),
  ('T1', 'T2', 'permanent', 6, 6, 12, 24, false, 'None; clinical PGY progression supportive', false, '2026-07-01', '2.3-draft'),
  ('T2', 'T3', 'permanent', 12, 12, 24, 36, true, 'None; fellowship progress / higher degree supportive', false, '2026-07-01', '2.3-draft'),
  ('T3', 'L1', 'permanent', 18, 18, 30, 36, true, 'None; understudy of Manager role mandatory', false, '2026-07-01', '2.3-draft'),
  ('L1', 'L2', 'permanent', 12, 12, 24, 36, true, 'None; understudy of L2 mandatory', false, '2026-07-01', '2.3-draft'),
  ('L2', 'L3', 'permanent', 18, 18, 36, 42, true, 'None; understudy of AP mandatory; business-need gate applies', true, '2026-07-01', '2.3-draft'),
  ('L3', 'P1', 'permanent', 24, 24, 48, NULL, true, 'Business-need and partnership-readiness gates; no maximum tenure (career AP pathway)', true, '2026-07-01', '2.3-draft')
ON CONFLICT (from_role_code, to_role_code, track, effective_from) DO NOTHING;

-- Talent pools. lead_ref holds the initials from the FY27 team structure;
-- resolve to lead_person_id during migration step M4.
INSERT INTO ref_talent_pool (pool_code, pool_name, lead_ref, effective_from, schema_version) VALUES
  ('POOL_APM', 'Associate Partner / Manager Pool', 'TT', '2026-07-01', '2.3-draft'),
  ('POOL_CONSULT', 'Consultant Pool', 'TT/CP', '2026-07-01', '2.3-draft'),
  ('POOL_EXPFEL', 'Expert / Fellow Pool', 'MB', '2026-07-01', '2.3-draft'),
  ('POOL_ANALYST', 'Analyst Pool', 'CP', '2026-07-01', '2.3-draft')
ON CONFLICT (pool_code, effective_from) DO NOTHING;

-- Which role codes sit in which pool
INSERT INTO ref_pool_role (pool_code, role_code, effective_from) VALUES
  ('POOL_APM', 'L3', '2026-07-01'),
  ('POOL_APM', 'L2', '2026-07-01'),
  ('POOL_APM', 'L1', '2026-07-01'),
  ('POOL_CONSULT', 'T1', '2026-07-01'),
  ('POOL_CONSULT', 'T2', '2026-07-01'),
  ('POOL_CONSULT', 'T3', '2026-07-01'),
  ('POOL_EXPFEL', 'E1', '2026-07-01'),
  ('POOL_EXPFEL', 'E2', '2026-07-01'),
  ('POOL_EXPFEL', 'F1', '2026-07-01'),
  ('POOL_EXPFEL', 'F2', '2026-07-01'),
  ('POOL_EXPFEL', 'ADV', '2026-07-01'),
  ('POOL_ANALYST', 'A1', '2026-07-01'),
  ('POOL_ANALYST', 'A2', '2026-07-01'),
  ('POOL_ANALYST', 'A3', '2026-07-01'),
  ('POOL_ANALYST', 'I0', '2026-07-01')
ON CONFLICT (pool_code, role_code, effective_from) DO NOTHING;

-- Credential modifiers. These attach to a person and position the rate
-- within band. They never change the role code.
INSERT INTO ref_credential_type (credential_key, allowed_values, affects_rate,
  triggers_supervision, description) VALUES
  ('ahpra_registration', ARRAY['none','provisional','general','specialist'], true, true, 'Provisional registration triggers supervision overlay (named supervisor, structured supervision plan per AHPRA pathway).'),
  ('fellowship_status', ARRAY['none','advanced_trainee','fellowed'], true, false, 'Supports upper-band rate positioning; F-rail eligibility.'),
  ('clinical_experience_pgy', NULL, true, false, 'Rate positioning within band.'),
  ('higher_degree', ARRAY['none','masters','phd','md_phd'], true, false, 'Rate positioning; Expert-rail eligibility signal.'),
  ('prior_consulting', ARRAY['none','boutique','big4','mbb'], true, false, 'Rate positioning and level mapping at entry.')
ON CONFLICT (credential_key) DO NOTHING;

-- Legacy label to canonical code. Applied once in migration step M4.
-- Identity rows are included so unchanged codes resolve too; rows with
-- requires_review = true must be resolved with the MP before migrating.
INSERT INTO ref_role_code_map (legacy_label, legacy_source, canonical_role_code, requires_review, review_note) VALUES
  ('MP', 'platform', 'MP', false, NULL),
  ('Managing Partner (MP)', 'platform', 'MP', false, NULL),
  ('P1', 'platform', 'P1', false, NULL),
  ('Partner (P1)', 'platform', 'P1', false, NULL),
  ('L3', 'platform', 'L3', false, NULL),
  ('Associate Partner / Director (L3)', 'platform', 'L3', false, NULL),
  ('L2', 'platform', 'L2', false, NULL),
  ('Senior Manager / Project Director (L2)', 'platform', 'L2', false, NULL),
  ('L1', 'platform', 'L1', false, NULL),
  ('Manager / Project Manager (L1)', 'platform', 'L1', false, NULL),
  ('ADV', 'platform', 'ADV', false, NULL),
  ('Advisor (ADV)', 'platform', 'ADV', false, NULL),
  ('E2', 'platform', 'E2', false, NULL),
  ('Senior Expert (E2)', 'platform', 'E2', false, NULL),
  ('E1', 'platform', 'E1', false, NULL),
  ('Expert (E1)', 'platform', 'E1', false, NULL),
  ('F2', 'platform', 'F2', false, NULL),
  ('Fellow (F2)', 'platform', 'F2', false, NULL),
  ('F1', 'platform', 'F1', false, NULL),
  ('Junior Fellow (F1)', 'platform', 'F1', false, NULL),
  ('T3', 'platform', 'T3', false, NULL),
  ('Senior Consultant (T3)', 'platform', 'T3', false, NULL),
  ('T2', 'platform', 'T2', false, NULL),
  ('Consultant (T2)', 'platform', 'T2', false, NULL),
  ('T1', 'platform', 'T1', false, NULL),
  ('Junior Consultant (T1)', 'platform', 'T1', false, NULL),
  ('A3', 'platform', 'A3', false, NULL),
  ('Senior Analyst (A3)', 'platform', 'A3', false, NULL),
  ('A2', 'platform', 'A2', false, NULL),
  ('Analyst (A2)', 'platform', 'A2', false, NULL),
  ('A1', 'platform', 'A1', false, NULL),
  ('Junior Analyst (A1)', 'platform', 'A1', false, NULL),
  ('I0', 'platform', 'I0', false, NULL),
  ('Intern (I0)', 'platform', 'I0', false, NULL),
  ('Partner (L3)', '2025_position_description', 'P1', false, NULL),
  ('Partner', '2025_position_description', 'P1', false, NULL),
  ('L3', '2025_position_description', 'P1', false, NULL),
  ('Partner (L4)', 'fy23_24_rate_card', 'P1', false, NULL),
  ('L4', 'fy23_24_rate_card', 'P1', false, NULL),
  ('Associate Partner (L2)', '2025_position_description', 'L3', false, NULL),
  ('L2', '2025_position_description', 'L3', false, NULL),
  ('Associate Partner (L3)', 'fy23_24_rate_card', 'L3', false, NULL),
  ('Associate Partner / Director', 'platform', 'L3', false, NULL),
  ('Project Director / Sr Manager', 'platform', 'L2', false, NULL),
  ('Project Director / Senior Manager (L2)', 'fy23_24_rate_card', 'L2', false, NULL),
  ('Project Manager / Manager', 'platform', 'L1', false, NULL),
  ('Consultant (junior)', 'platform', 'T1', false, NULL),
  ('Subject Matter Expert', 'onboarding_deck', 'E1', false, NULL),
  ('Advisor', 'onboarding_deck', 'ADV', false, NULL),
  ('Consultant (0.5 FTE)', 'offer_letter', NULL, true, 'Employment offer title. The canonical code depends on the individual''s assessed grade (T1, T2 or T3) and cannot be derived automatically. Resolve with the MP, then record the code plus the permanent overlay and AHPRA credential modifiers.'),
  ('Consultant', 'offer_letter', NULL, true, 'Ambiguous: may be an employed Consultant or a contractor T-grade. Resolve engagement type and grade with the MP before migrating.')
ON CONFLICT (legacy_label, legacy_source) DO NOTHING;

COMMIT;
