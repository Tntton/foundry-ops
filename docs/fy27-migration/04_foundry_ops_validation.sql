-- ===========================================================================
-- Foundry Ops : integrity checks and acceptance tests
-- File 4 of 4 : validation
--
-- Every view below must return ZERO rows. Wire them into CI so the
-- architecture's rules are enforced continuously, not just at migration.
-- ===========================================================================

BEGIN;
SET search_path TO foundry, public;

-- ---------------------------------------------------------------------------
-- INTEGRITY EXCEPTIONS. Cross-table rules a CHECK constraint cannot express.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_integrity_exceptions AS

-- 1. Engagement type not permitted for the person's role.
--    Catches an Expert or Fellow being set up as an employee, which the
--    architecture forbids: permanent entry is via the Consultant track.
SELECT 'engagement_not_permitted_for_role' AS rule, pc.person_id, pc.full_name,
       pc.role_code || ' / ' || pc.engagement_type AS detail
FROM v_person_current pc
JOIN v_ref_role_current r ON r.role_code = pc.role_code
WHERE pc.engagement_type IS NOT NULL AND (
      (pc.engagement_type = 'permanent'  AND NOT r.permits_permanent)
   OR (pc.engagement_type = 'contractor' AND NOT r.permits_contractor)
   OR (pc.engagement_type = 'program'    AND NOT r.permits_program)
   OR (pc.engagement_type = 'honorary'   AND NOT r.permits_honorary))

UNION ALL
-- 2. Advisor status held without the ADV role code, or the reverse.
SELECT 'advisor_status_role_mismatch', person_id, full_name,
       COALESCE(role_code,'(none)') || ' / ' || COALESCE(status_code,'(none)')
FROM v_person_current
WHERE (status_code = 'ADVISOR' AND role_code IS DISTINCT FROM 'ADV')
   OR (role_code = 'ADV' AND status_code NOT IN ('ADVISOR','ALUMNI'))

UNION ALL
-- 3. Contractors are not incentive-eligible.
SELECT 'incentive_award_to_contractor', pc.person_id, pc.full_name, ia.period_fy
FROM incentive_award ia
JOIN v_person_current pc ON pc.person_id = ia.person_id
WHERE pc.engagement_type <> 'permanent'

UNION ALL
-- 4. Any rate off the band anchor must be MP-approved.
SELECT 'rate_deviation_not_mp_approved', pr.person_id, p.full_name,
       pr.rate_basis || ' approved_by=' || pr.approved_by
FROM person_rate pr JOIN person p ON p.person_id = pr.person_id
WHERE pr.rate_basis <> 'band_anchor' AND pr.approved_by <> 'MP'

UNION ALL
-- 5. No worse off: a rate cut at the FY27 transition is a breach.
SELECT 'no_worse_off_breach', cur.person_id, p.full_name,
       'was ' || prev.cost_hr || ' now ' || cur.cost_hr
FROM person_rate cur
JOIN person_rate prev ON prev.person_id = cur.person_id AND prev.geo = cur.geo
                     AND prev.effective_from < cur.effective_from
JOIN person p ON p.person_id = cur.person_id
WHERE cur.effective_from = DATE '2026-07-01'
  AND cur.cost_hr < prev.cost_hr
  AND prev.effective_from = (SELECT MAX(x.effective_from) FROM person_rate x
                             WHERE x.person_id = cur.person_id AND x.geo = cur.geo
                               AND x.effective_from < cur.effective_from)

UNION ALL
-- 6. Permanent staff must have an FTE fraction.
SELECT 'permanent_without_fte', person_id, full_name, COALESCE(employment_basis,'(null)')
FROM v_person_current
WHERE engagement_type = 'permanent' AND fte_fraction IS NULL

UNION ALL
-- 7. Interns must sit at zero cost.
SELECT 'intern_with_nonzero_rate', pc.person_id, pc.full_name, pc.cost_hr::text
FROM v_person_current pc
WHERE pc.role_code = 'I0' AND COALESCE(pc.cost_hr,0) <> 0

UNION ALL
-- 8. Two dimension rows on the same day for one person: ambiguous ordering.
SELECT 'duplicate_effective_date', person_id, NULL, 'person_role ' || effective_from::text
FROM (SELECT person_id, effective_from, COUNT(*) c FROM person_role
      GROUP BY 1,2 HAVING COUNT(*) > 1) d

UNION ALL
-- 9. Someone on Reserve or Alumni still holding an open team assignment.
SELECT 'inactive_with_team_assignment', pc.person_id, pc.full_name, pt.team_code
FROM v_person_current pc
JOIN LATERAL (SELECT DISTINCT ON (team_code) team_code, is_member FROM person_team t
              WHERE t.person_id = pc.person_id AND t.effective_from <= CURRENT_DATE
              ORDER BY team_code, effective_from DESC) pt ON pt.is_member
WHERE pc.status_code IN ('RESERVE','ALUMNI')

UNION ALL
-- 10. A person holding a role but no status at all. Their tenure would read
--     as zero and they would be invisible to every status-driven report.
SELECT 'person_without_status', p.person_id, p.full_name, 'no person_status row'
FROM person p
WHERE EXISTS (SELECT 1 FROM person_role r WHERE r.person_id = p.person_id)
  AND NOT EXISTS (SELECT 1 FROM person_status st WHERE st.person_id = p.person_id);

-- ---------------------------------------------------------------------------
-- RECONCILIATION. Run before and after cutover; the "before" figures come
-- from the legacy system and must agree.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_migration_reconciliation AS
SELECT 'people_migrated'          AS measure, COUNT(*)::text AS value FROM person
UNION ALL SELECT 'with_role',        COUNT(DISTINCT person_id)::text FROM person_role
UNION ALL SELECT 'with_engagement',  COUNT(DISTINCT person_id)::text FROM person_engagement
UNION ALL SELECT 'with_status',      COUNT(DISTINCT person_id)::text FROM person_status
UNION ALL SELECT 'permanent_ft',     COUNT(*)::text FROM v_person_current WHERE employment_basis='full_time'
UNION ALL SELECT 'permanent_pt',     COUNT(*)::text FROM v_person_current WHERE employment_basis='part_time'
UNION ALL SELECT 'contractors',      COUNT(*)::text FROM v_person_current WHERE engagement_type='contractor'
UNION ALL SELECT 'total_fte',        ROUND(SUM(COALESCE(fte_fraction,0)),2)::text FROM v_person_current
UNION ALL SELECT 'rates_grandfathered', COUNT(*)::text FROM person_rate WHERE rate_basis='grandfathered'
UNION ALL SELECT 'rates_below_anchor',  COUNT(*)::text FROM person_rate WHERE rate_basis='deviation_below'
UNION ALL SELECT 'integrity_exceptions', COUNT(*)::text FROM v_integrity_exceptions;

-- ---------------------------------------------------------------------------
-- OPERATIONAL HELPERS the application layer should call, not reimplement.
-- ---------------------------------------------------------------------------

-- Effective pay for a permanent person = full-time salary x FTE.
-- Salary is never rewritten when someone moves between full and part time.
CREATE OR REPLACE VIEW v_effective_salary AS
SELECT pc.person_id, pc.full_name, pc.employment_basis, pc.fte_fraction,
       pr.base_salary_fulltime, pr.currency,
       ROUND(pr.base_salary_fulltime * pc.fte_fraction, 2) AS effective_salary,
       COALESCE(pr.incentive_target_pct_override, r.incentive_target_pct) AS incentive_target_pct
FROM v_person_current pc
JOIN v_ref_role_current r ON r.role_code = pc.role_code
JOIN LATERAL (SELECT * FROM person_remuneration x WHERE x.person_id = pc.person_id
              AND x.effective_from <= CURRENT_DATE
              ORDER BY x.effective_from DESC LIMIT 1) pr ON true
WHERE pc.engagement_type = 'permanent';

-- People approaching or past the soft maximum in role. Triggers a career
-- conversation, never an automatic exit.
CREATE OR REPLACE VIEW v_tenure_watchlist AS
SELECT e.person_id, e.full_name, e.current_role_code, e.next_role_code,
       e.active_months, e.max_months, e.over_soft_maximum,
       e.gate1_tenure_met, e.gate4_understudy_complete
FROM v_promotion_eligibility e
WHERE e.over_soft_maximum
   OR (e.max_months IS NOT NULL AND e.active_months >= e.max_months - 6)
ORDER BY e.active_months DESC;

-- Reserve members due for a check-in, and anyone past the nominal 24 months.
CREATE OR REPLACE VIEW v_reserve_review AS
SELECT pc.person_id, pc.full_name, pc.role_code, pc.pool_code,
       pc.status_since, pc.status_reason, pc.expected_return,
       (CURRENT_DATE - pc.status_since) AS days_on_reserve,
       ((CURRENT_DATE - pc.status_since) > 730) AS past_nominal_24_months
FROM v_person_current pc
WHERE pc.status_code = 'RESERVE'
ORDER BY days_on_reserve DESC;

COMMIT;
