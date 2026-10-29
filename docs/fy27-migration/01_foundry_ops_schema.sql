-- ============================================================================
-- Foundry Ops : personnel data model for the FY27 role architecture
-- File 1 of 4 : structure (tables, constraints, views)
--
-- Target      : PostgreSQL 14+
-- Principle   : APPEND-ONLY. Domain rows are never updated or deleted.
--               Change = INSERT a new row with a later effective_from.
--               Current state is DERIVED in views, never stored.
-- Idempotent  : safe to re-run.
-- Australian English throughout.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS foundry;
SET search_path TO foundry, public;

-- ---------------------------------------------------------------------------
-- 0. Append-only enforcement
-- ---------------------------------------------------------------------------
-- Corrections are made by inserting a new row with change_reason = 'correction'
-- and supersedes_id pointing at the row being corrected. Nothing is ever edited.

CREATE OR REPLACE FUNCTION foundry.block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'foundry.% is append-only. Insert a new effective-dated row (change_reason = ''correction'' with supersedes_id if fixing an error).',
    TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION foundry.apply_append_only(tbl text) RETURNS void AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS trg_append_only ON foundry.%I', tbl);
  EXECUTE format(
    'CREATE TRIGGER trg_append_only BEFORE UPDATE OR DELETE ON foundry.%I
       FOR EACH ROW EXECUTE FUNCTION foundry.block_mutation()', tbl);
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. Reference data (versioned; seeded from foundry_roles_schema.json)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ref_band (
  band_code        text        NOT NULL,
  band_name        text        NOT NULL,
  notes            text,
  effective_from   date        NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  schema_version   text        NOT NULL,
  PRIMARY KEY (band_code, effective_from)
);

CREATE TABLE IF NOT EXISTS ref_role (
  role_code            text        NOT NULL,
  title                text        NOT NULL,
  band_code            text        NOT NULL,
  seniority_rank       int         NOT NULL,
  dual_pathway         boolean     NOT NULL,
  permits_permanent    boolean     NOT NULL,
  permits_contractor   boolean     NOT NULL,
  permits_program      boolean     NOT NULL DEFAULT false,
  permits_honorary     boolean     NOT NULL DEFAULT false,
  remuneration_model   text        NOT NULL,
  incentive_target_pct numeric(5,2),          -- NULL = not incentive-eligible
  notes                text,
  effective_from       date        NOT NULL,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  schema_version       text        NOT NULL,
  PRIMARY KEY (role_code, effective_from),
  CONSTRAINT ref_role_engagement_ck CHECK (
    permits_permanent OR permits_contractor OR permits_program OR permits_honorary)
);

-- Cost is stored; bill rates are ALWAYS derived (see v_rate_card_current).
CREATE TABLE IF NOT EXISTS ref_rate_band (
  role_code          text        NOT NULL,
  geo                text        NOT NULL CHECK (geo IN ('AU','NZ','US','UK')),
  currency           char(3)     NOT NULL,
  rate_basis         text        NOT NULL CHECK (rate_basis IN ('cost_derived','bill_override','not_time_billed')),
  cost_hr            numeric(10,2),
  bill_low_override  numeric(10,2),
  bill_high_override numeric(10,2),
  effective_from     date        NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  schema_version     text        NOT NULL,
  PRIMARY KEY (role_code, geo, effective_from),
  CONSTRAINT ref_rate_band_shape_ck CHECK (
       (rate_basis = 'cost_derived'    AND cost_hr IS NOT NULL)
    OR (rate_basis = 'bill_override'   AND bill_low_override IS NOT NULL AND bill_high_override IS NOT NULL)
    OR (rate_basis = 'not_time_billed' AND cost_hr IS NULL AND bill_low_override IS NULL))
);

CREATE TABLE IF NOT EXISTS ref_billing_multiple (
  bill_low_multiple  numeric(4,2) NOT NULL,
  bill_high_multiple numeric(4,2) NOT NULL,
  effective_from     date         NOT NULL PRIMARY KEY,
  recorded_at        timestamptz  NOT NULL DEFAULT now(),
  schema_version     text         NOT NULL
);

CREATE TABLE IF NOT EXISTS ref_workforce_status (
  status_code    text        NOT NULL,
  status_name    text        NOT NULL,
  clock_accrues  boolean     NOT NULL,      -- does time-in-role accrue in this status
  systems_access boolean     NOT NULL,
  description    text,
  effective_from date        NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  schema_version text        NOT NULL,
  PRIMARY KEY (status_code, effective_from)
);

CREATE TABLE IF NOT EXISTS ref_promotion_step (
  from_role_code      text    NOT NULL,
  to_role_code        text    NOT NULL,
  track               text    NOT NULL CHECK (track IN ('permanent','contractor')),
  min_months          int,
  typical_min_months  int,
  typical_max_months  int,
  max_months          int,                  -- NULL = no maximum
  understudy_required boolean NOT NULL DEFAULT false,
  qualification_gate  text,
  business_need_gate  boolean NOT NULL DEFAULT false,
  effective_from      date    NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  schema_version      text    NOT NULL,
  PRIMARY KEY (from_role_code, to_role_code, track, effective_from)
);

CREATE TABLE IF NOT EXISTS ref_talent_pool (
  pool_code      text        NOT NULL,
  pool_name      text        NOT NULL,
  lead_ref       text,                       -- initials until resolved to person_id
  lead_person_id bigint,
  effective_from date        NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  schema_version text        NOT NULL,
  PRIMARY KEY (pool_code, effective_from)
);

CREATE TABLE IF NOT EXISTS ref_pool_role (
  pool_code      text NOT NULL,
  role_code      text NOT NULL,
  effective_from date NOT NULL,
  PRIMARY KEY (pool_code, role_code, effective_from)
);

CREATE TABLE IF NOT EXISTS ref_credential_type (
  credential_key   text NOT NULL PRIMARY KEY,
  allowed_values   text[],                   -- NULL = free/numeric
  affects_rate     boolean NOT NULL DEFAULT true,
  triggers_supervision boolean NOT NULL DEFAULT false,
  description      text
);

-- Legacy label -> canonical code. Used once at migration, retained for audit.
CREATE TABLE IF NOT EXISTS ref_role_code_map (
  legacy_label        text    NOT NULL,
  legacy_source       text    NOT NULL,
  canonical_role_code text,                 -- NULL where the code cannot be derived
  requires_review     boolean NOT NULL DEFAULT false,
  review_note         text,
  PRIMARY KEY (legacy_label, legacy_source),
  CONSTRAINT ref_role_code_map_ck CHECK (canonical_role_code IS NOT NULL OR requires_review)
);

-- ---------------------------------------------------------------------------
-- 2. Person identity (immutable facts only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS person (
  person_id      bigserial   PRIMARY KEY,
  legacy_ref     text UNIQUE,               -- id/initials in the pre-migration system
  full_name      text        NOT NULL,
  preferred_name text,
  work_email     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Person dimensions (append-only, effective-dated)
--    One row per change. Current value = latest effective_from <= today.
-- ---------------------------------------------------------------------------

-- 3a. ENGAGEMENT : this is where full-time / part-time / contractor lives.
CREATE TABLE IF NOT EXISTS person_engagement (
  person_engagement_id bigserial PRIMARY KEY,
  person_id        bigint      NOT NULL REFERENCES person(person_id),
  effective_from   date        NOT NULL,
  engagement_type  text        NOT NULL CHECK (engagement_type IN ('permanent','contractor','program','honorary')),
  employment_basis text        CHECK (employment_basis IN ('full_time','part_time')),
  fte_fraction     numeric(4,3) CHECK (fte_fraction > 0 AND fte_fraction <= 1),
  legal_entity     text,
  contractor_abn   text,
  change_reason    text        NOT NULL CHECK (change_reason IN
                     ('migration','hire','conversion','basis_change','re_entry','exit','correction')),
  supersedes_id    bigint      REFERENCES person_engagement(person_engagement_id),
  approved_by      text        NOT NULL,
  evidence_ref     text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, effective_from),
  -- Permanent must state full/part time and an FTE fraction; others must not.
  CONSTRAINT person_engagement_basis_ck CHECK (
    (engagement_type = 'permanent'  AND employment_basis IS NOT NULL AND fte_fraction IS NOT NULL)
    OR
    (engagement_type <> 'permanent' AND employment_basis IS NULL     AND fte_fraction IS NULL)),
  -- Full time is 1.0 FTE by definition; part time is anything less.
  CONSTRAINT person_engagement_fte_ck CHECK (
    employment_basis IS NULL
    OR (employment_basis = 'full_time' AND fte_fraction = 1.000)
    OR (employment_basis = 'part_time' AND fte_fraction < 1.000))
);

-- 3b. ROLE : hires, promotions, contractor re-grades, conversions, re-entries.
CREATE TABLE IF NOT EXISTS person_role (
  person_role_id  bigserial PRIMARY KEY,
  person_id       bigint      NOT NULL REFERENCES person(person_id),
  effective_from  date        NOT NULL,
  role_code       text        NOT NULL,
  change_reason   text        NOT NULL CHECK (change_reason IN
                    ('migration','hire','promotion','re_grade','conversion','re_entry','lateral','correction')),
  sponsor_person_id bigint    REFERENCES person(person_id),
  calibration_ref text,                     -- promotion round / committee reference
  evidence_ref    text,                     -- evidence pack location
  supersedes_id   bigint      REFERENCES person_role(person_role_id),
  approved_by     text        NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, effective_from)
);

-- 3c. STATUS : Active / Reserve ("shelved") / Alumni / Advisor.
CREATE TABLE IF NOT EXISTS person_status (
  person_status_id bigserial PRIMARY KEY,
  person_id       bigint      NOT NULL REFERENCES person(person_id),
  effective_from  date        NOT NULL,
  status_code     text        NOT NULL,
  reason          text        CHECK (reason IS NULL OR reason IN
                    ('training','fellowship','study','parental_leave','other_role','personal',
                     'end_of_engagement','resignation','retirement','migration','other')),
  expected_return date,
  pause_mechanism text        CHECK (pause_mechanism IS NULL OR pause_mechanism IN
                    ('unpaid_leave_role_held','resignation_to_alumni','contractor_dormant')),
  pool_lead_notified boolean  NOT NULL DEFAULT false,
  supersedes_id   bigint      REFERENCES person_status(person_status_id),
  approved_by     text        NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, effective_from)
);

-- 3d. RATE : person-level, with the no-worse-off / deviation audit trail.
CREATE TABLE IF NOT EXISTS person_rate (
  person_rate_id  bigserial PRIMARY KEY,
  person_id       bigint      NOT NULL REFERENCES person(person_id),
  effective_from  date        NOT NULL,
  geo             text        NOT NULL CHECK (geo IN ('AU','NZ','US','UK')),
  currency        char(3)     NOT NULL,
  cost_hr         numeric(10,2) NOT NULL CHECK (cost_hr >= 0),
  rate_basis      text        NOT NULL CHECK (rate_basis IN
                    ('band_anchor','negotiated_in_band','deviation_above','deviation_below','grandfathered')),
  deviation_reason text,
  engagement_ref  text,                     -- work order / engagement this applies to
  supersedes_id   bigint      REFERENCES person_rate(person_rate_id),
  approved_by     text        NOT NULL,     -- must be the MP for any non-anchor rate
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, geo, effective_from),
  -- Anything off the band anchor must carry a reason.
  CONSTRAINT person_rate_reason_ck CHECK (
    rate_basis IN ('band_anchor','negotiated_in_band') OR deviation_reason IS NOT NULL)
);

-- 3e. SALARY / package for permanent staff.
CREATE TABLE IF NOT EXISTS person_remuneration (
  person_remuneration_id bigserial PRIMARY KEY,
  person_id       bigint      NOT NULL REFERENCES person(person_id),
  effective_from  date        NOT NULL,
  currency        char(3)     NOT NULL,
  base_salary_fulltime numeric(12,2) NOT NULL,   -- always the 1.0 FTE figure
  super_pct       numeric(5,2),
  incentive_target_pct_override numeric(5,2),
  supersedes_id   bigint      REFERENCES person_remuneration(person_remuneration_id),
  approved_by     text        NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, effective_from)
);

-- 3f. CREDENTIALS : person-level modifiers. Never change the role code.
CREATE TABLE IF NOT EXISTS person_credential (
  person_credential_id bigserial PRIMARY KEY,
  person_id       bigint      NOT NULL REFERENCES person(person_id),
  effective_from  date        NOT NULL,
  credential_key  text        NOT NULL REFERENCES ref_credential_type(credential_key),
  credential_value text       NOT NULL,
  obtained_while_inactive boolean NOT NULL DEFAULT false,
  evidence_ref    text,
  supersedes_id   bigint      REFERENCES person_credential(person_credential_id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, credential_key, effective_from)
);

-- 3g. POOL and TEAM assignment (orthogonal to role code).
CREATE TABLE IF NOT EXISTS person_pool (
  person_pool_id bigserial PRIMARY KEY,
  person_id      bigint NOT NULL REFERENCES person(person_id),
  effective_from date   NOT NULL,
  pool_code      text   NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, effective_from)
);

CREATE TABLE IF NOT EXISTS person_team (
  person_team_id bigserial PRIMARY KEY,
  person_id      bigint NOT NULL REFERENCES person(person_id),
  effective_from date   NOT NULL,
  team_code      text   NOT NULL,
  team_type      text   NOT NULL CHECK (team_type IN ('core','internal_project')),
  team_role      text,
  is_member      boolean NOT NULL DEFAULT true,   -- false row = left the team
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, team_code, effective_from)
);

-- 3h. UNDERSTUDY assignments (a promotion gate from T3 upward).
CREATE TABLE IF NOT EXISTS understudy_assignment (
  understudy_id   bigserial PRIMARY KEY,
  person_id       bigint NOT NULL REFERENCES person(person_id),
  target_role_code text  NOT NULL,
  started_on      date   NOT NULL,
  completed_on    date,
  outcome         text   CHECK (outcome IS NULL OR outcome IN ('completed','discontinued')),
  confirmed_by    text,
  evidence_ref    text,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

-- 3i. INCENTIVE awards (standardised dimensions, discretionary amount).
CREATE TABLE IF NOT EXISTS incentive_award (
  incentive_award_id bigserial PRIMARY KEY,
  person_id       bigint NOT NULL REFERENCES person(person_id),
  period_fy        text  NOT NULL,          -- e.g. 'FY27'
  target_pct       numeric(5,2) NOT NULL,
  client_impact           text CHECK (client_impact           IN ('below','threshold','target','stretch')),
  commercial_contribution text CHECK (commercial_contribution IN ('below','threshold','target','stretch')),
  team_leadership         text CHECK (team_leadership         IN ('below','threshold','target','stretch')),
  firm_ip_contribution    text CHECK (firm_ip_contribution    IN ('below','threshold','target','stretch')),
  awarded_pct     numeric(5,2),
  committee_ref   text NOT NULL,            -- Partnership / Remuneration Committee decision
  approved_by     text NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, period_fy)
);

-- Apply append-only protection to every domain table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ref_band','ref_role','ref_rate_band','ref_billing_multiple','ref_workforce_status',
    'ref_promotion_step','ref_talent_pool','ref_pool_role',
    'person_engagement','person_role','person_status','person_rate','person_remuneration',
    'person_credential','person_pool','person_team','incentive_award']
  LOOP
    PERFORM foundry.apply_append_only(t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Derived views. Current state is computed, never stored.
-- ---------------------------------------------------------------------------

-- 4a. Turn append-only rows into intervals using the next row's start date.
CREATE OR REPLACE VIEW v_role_interval AS
SELECT person_id, role_code, change_reason, effective_from AS valid_from,
       LEAD(effective_from) OVER (PARTITION BY person_id ORDER BY effective_from) AS valid_to
FROM person_role;

CREATE OR REPLACE VIEW v_status_interval AS
SELECT person_id, status_code, reason, effective_from AS valid_from,
       LEAD(effective_from) OVER (PARTITION BY person_id ORDER BY effective_from) AS valid_to
FROM person_status;

CREATE OR REPLACE VIEW v_engagement_interval AS
SELECT person_id, engagement_type, employment_basis, fte_fraction,
       effective_from AS valid_from,
       LEAD(effective_from) OVER (PARTITION BY person_id ORDER BY effective_from) AS valid_to
FROM person_engagement;

-- 4b. Current reference rows.
CREATE OR REPLACE VIEW v_ref_role_current AS
SELECT DISTINCT ON (role_code) *
FROM ref_role WHERE effective_from <= CURRENT_DATE
ORDER BY role_code, effective_from DESC;

CREATE OR REPLACE VIEW v_ref_rate_band_current AS
SELECT DISTINCT ON (role_code, geo) *
FROM ref_rate_band WHERE effective_from <= CURRENT_DATE
ORDER BY role_code, geo, effective_from DESC;

-- 4c. Rate card with bill rates DERIVED, never stored.
CREATE OR REPLACE VIEW v_rate_card_current AS
SELECT rb.role_code, r.title, r.band_code, rb.geo, rb.currency, rb.rate_basis, rb.cost_hr,
       CASE WHEN rb.rate_basis = 'cost_derived'  THEN ROUND(rb.cost_hr * m.bill_low_multiple, 2)
            WHEN rb.rate_basis = 'bill_override' THEN rb.bill_low_override END  AS bill_low,
       CASE WHEN rb.rate_basis = 'cost_derived'  THEN ROUND(rb.cost_hr * m.bill_high_multiple, 2)
            WHEN rb.rate_basis = 'bill_override' THEN rb.bill_high_override END AS bill_high,
       rb.effective_from
FROM v_ref_rate_band_current rb
JOIN v_ref_role_current r ON r.role_code = rb.role_code
CROSS JOIN LATERAL (
  SELECT bill_low_multiple, bill_high_multiple FROM ref_billing_multiple
  WHERE effective_from <= CURRENT_DATE ORDER BY effective_from DESC LIMIT 1) m;

-- 4d. Current person state, one row per person.
CREATE OR REPLACE VIEW v_person_current AS
SELECT p.person_id, p.full_name, p.preferred_name, p.work_email,
       ro.role_code, rr.title AS role_title, rr.band_code, ro.effective_from AS role_since,
       st.status_code, st.reason AS status_reason, st.expected_return, st.effective_from AS status_since,
       en.engagement_type, en.employment_basis, en.fte_fraction,
       pl.pool_code,
       ra.geo, ra.currency, ra.cost_hr, ra.rate_basis
FROM person p
LEFT JOIN LATERAL (SELECT * FROM person_role  x WHERE x.person_id=p.person_id AND x.effective_from<=CURRENT_DATE
                   ORDER BY x.effective_from DESC LIMIT 1) ro ON true
LEFT JOIN LATERAL (SELECT * FROM person_status x WHERE x.person_id=p.person_id AND x.effective_from<=CURRENT_DATE
                   ORDER BY x.effective_from DESC LIMIT 1) st ON true
LEFT JOIN LATERAL (SELECT * FROM person_engagement x WHERE x.person_id=p.person_id AND x.effective_from<=CURRENT_DATE
                   ORDER BY x.effective_from DESC LIMIT 1) en ON true
LEFT JOIN LATERAL (SELECT * FROM person_pool x WHERE x.person_id=p.person_id AND x.effective_from<=CURRENT_DATE
                   ORDER BY x.effective_from DESC LIMIT 1) pl ON true
LEFT JOIN LATERAL (SELECT * FROM person_rate x WHERE x.person_id=p.person_id AND x.effective_from<=CURRENT_DATE
                   ORDER BY x.effective_from DESC LIMIT 1) ra ON true
LEFT JOIN v_ref_role_current rr ON rr.role_code = ro.role_code;

-- 4e. THE TENURE CLOCK.
-- Time in the current role counts ONLY the days spent in a status where
-- clock_accrues is true (Active). Reserve pauses the clock; it never resets it.
CREATE OR REPLACE VIEW v_role_tenure AS
WITH cur_role AS (
  SELECT person_id, role_code, valid_from
  FROM v_role_interval WHERE valid_to IS NULL
),
accrue AS (
  SELECT DISTINCT ON (status_code) status_code, clock_accrues
  FROM ref_workforce_status WHERE effective_from <= CURRENT_DATE
  ORDER BY status_code, effective_from DESC
)
SELECT cr.person_id, cr.role_code, cr.valid_from AS role_since,
       (CURRENT_DATE - cr.valid_from)                       AS elapsed_days,
       -- NOTE: the CASE guard is essential. PostgreSQL's GREATEST/LEAST IGNORE
       -- NULL arguments instead of propagating them, so an unmatched LEFT JOIN
       -- would otherwise silently return the full elapsed period and credit
       -- Reserve and Alumni time as active tenure.
       COALESCE(SUM(CASE WHEN si.valid_from IS NULL THEN 0 ELSE GREATEST(0,
           LEAST(COALESCE(si.valid_to, CURRENT_DATE), CURRENT_DATE)
         - GREATEST(si.valid_from, cr.valid_from)) END), 0)  AS active_days,
       ROUND(COALESCE(SUM(CASE WHEN si.valid_from IS NULL THEN 0 ELSE GREATEST(0,
           LEAST(COALESCE(si.valid_to, CURRENT_DATE), CURRENT_DATE)
         - GREATEST(si.valid_from, cr.valid_from)) END), 0) / 30.44, 1) AS active_months
FROM cur_role cr
LEFT JOIN v_status_interval si
       ON si.person_id = cr.person_id
      AND si.status_code IN (SELECT status_code FROM accrue WHERE clock_accrues)
      AND COALESCE(si.valid_to, CURRENT_DATE) > cr.valid_from
      AND si.valid_from < CURRENT_DATE
GROUP BY cr.person_id, cr.role_code, cr.valid_from;

-- 4f. Promotion eligibility: the machine-checkable gates only.
-- Gates 3 (contribution), 5 (sponsorship/calibration) and 6 (business need)
-- are human decisions and are surfaced, not computed.
CREATE OR REPLACE VIEW v_promotion_eligibility AS
-- NOTE: the column is current_role_code, not current_role. current_role is a
-- reserved PostgreSQL function and silently returns the database role name.
SELECT t.person_id, pc.full_name, t.role_code AS current_role_code, s.to_role_code AS next_role_code,
       t.active_months, s.min_months, s.max_months,
       (t.active_months >= s.min_months)                              AS gate1_tenure_met,
       s.qualification_gate                                           AS gate2_qualification_gate,
       s.understudy_required,
       EXISTS (SELECT 1 FROM understudy_assignment u
               WHERE u.person_id = t.person_id AND u.target_role_code = s.to_role_code
                 AND u.outcome = 'completed')                         AS gate4_understudy_complete,
       s.business_need_gate                                           AS gate6_business_need_applies,
       (s.max_months IS NOT NULL AND t.active_months > s.max_months)  AS over_soft_maximum
FROM v_role_tenure t
JOIN v_person_current pc ON pc.person_id = t.person_id
JOIN LATERAL (
  SELECT DISTINCT ON (from_role_code) *
  FROM ref_promotion_step
  WHERE from_role_code = t.role_code AND track = 'permanent' AND effective_from <= CURRENT_DATE
  ORDER BY from_role_code, effective_from DESC) s ON true
WHERE pc.engagement_type = 'permanent' AND pc.status_code = 'ACTIVE';

-- 4g. No-worse-off check: flags anyone whose live rate sits outside the new band.
CREATE OR REPLACE VIEW v_rate_transition_check AS
SELECT pc.person_id, pc.full_name, pc.role_code, pc.engagement_type, pc.geo,
       pc.cost_hr AS current_cost_hr, rc.cost_hr AS band_anchor_hr,
       CASE WHEN rc.cost_hr IS NULL              THEN 'no_anchor_for_role'
            WHEN pc.cost_hr > rc.cost_hr         THEN 'above_anchor_preserve'
            WHEN pc.cost_hr < rc.cost_hr         THEN 'below_anchor_review'
            ELSE 'at_anchor' END                 AS transition_action
FROM v_person_current pc
LEFT JOIN v_rate_card_current rc ON rc.role_code = pc.role_code AND rc.geo = pc.geo
WHERE pc.engagement_type = 'contractor' AND pc.status_code = 'ACTIVE';

-- 4h. Headcount by engagement basis (full-time vs part-time vs pool).
CREATE OR REPLACE VIEW v_workforce_summary AS
SELECT status_code, engagement_type, COALESCE(employment_basis,'n/a') AS employment_basis,
       COUNT(*) AS people, ROUND(SUM(COALESCE(fte_fraction,0)),2) AS total_fte
FROM v_person_current
GROUP BY 1,2,3 ORDER BY 1,2,3;

COMMIT;
