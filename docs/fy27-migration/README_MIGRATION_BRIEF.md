# Foundry Ops: personnel database migration brief

**Purpose.** Update the Foundry Ops personnel database so it can carry the FY27 role
architecture: full-time versus part-time versus pool contractor, the workforce status
lifecycle including Reserve and Alumni, the promotions tenure clock, and FY27 rate bands
with the no-worse-off protection.

**Status.** Schema version 2.3-draft, effective 1 July 2026, pending Managing Partner
sign-off. Do not run in production until the MP has signed off and open decision OD-1
below is resolved.

---

## 1. Files in this package

| File | What it does | Hand-edit? |
|---|---|---|
| `01_foundry_ops_schema.sql` | Tables, constraints, append-only triggers, derived views | Yes |
| `02_foundry_ops_seed_fy27.sql` | FY27 reference data: roles, bands, rates, statuses, promotion steps, pools, code map | **No — generated** |
| `03_foundry_ops_backfill.sql` | Staging table and the backfill of existing people | Yes |
| `04_foundry_ops_validation.sql` | Integrity checks, reconciliation, operational views | Yes |
| `generate_seed.py` | Regenerates file 02 from `foundry_roles_schema.json` | Yes |

`foundry_roles_schema.json` is the source of truth. To change a rate, a role, an incentive
target or a promotion rule, edit the schema and re-run `generate_seed.py`. Never edit file
02 directly, or the platform will drift from the position descriptions and the deck.

```bash
python3 generate_seed.py ../foundry_roles_schema.json 02_foundry_ops_seed_fy27.sql
psql -d foundryops -v ON_ERROR_STOP=1 -f 01_foundry_ops_schema.sql
psql -d foundryops -v ON_ERROR_STOP=1 -f 02_foundry_ops_seed_fy27.sql
psql -d foundryops -v ON_ERROR_STOP=1 -f 03_foundry_ops_backfill.sql
psql -d foundryops -v ON_ERROR_STOP=1 -f 04_foundry_ops_validation.sql
```

All four files were written for PostgreSQL 14+ and have been executed end to end against
PostgreSQL 16 with test data covering every case below. They are idempotent.

---

## 2. Confirm these before writing any code

I could not see the Foundry Ops codebase, so the following are assumptions. Check each one
against the repository and adjust rather than assuming the package is correct.

1. **Engine and version.** Written for PostgreSQL. If Foundry Ops is on MySQL, SQLite or
   an ORM with its own migration tool, the logic ports but the syntax does not: `LATERAL`,
   `DISTINCT ON`, array columns and `plpgsql` triggers all need replacing.
2. **Schema name.** Everything is created in a `foundry` schema. Change `SET search_path`
   if the platform uses `public` or another namespace.
3. **Existing tables.** This package adds new tables and does not read or alter any
   existing ones. The only interface is the staging table in file 03, which you populate
   with a `SELECT` from the current personnel tables. Confirm the current table and column
   names before writing that `SELECT`.
4. **Whether an ORM owns the schema.** If migrations are managed by Django, Prisma,
   Alembic, Rails or similar, translate these files into that tool's migration format
   rather than running raw SQL, or the ORM's state will diverge from the database.
5. **Who "MP" is.** The `approved_by` columns take the literal string `'MP'`. If the
   platform has a users table, change these to a foreign key to the MP's user id.

---

## 3. Non-negotiable rules

1. **Append-only.** No domain row is ever updated or deleted. A change is a new row with a
   later `effective_from`. Corrections are new rows with `change_reason = 'correction'`
   and `supersedes_id` pointing at the row being corrected. This is enforced by triggers,
   not convention: `UPDATE` and `DELETE` raise an exception.
2. **Current state is derived, never stored.** There is no `is_current` flag and no
   `effective_to` column to maintain. Current state comes from the views. Anything that
   caches current state will go stale and start lying.
3. **Store cost, derive bill.** Bill rates are cost x 2 and cost x 3, computed in
   `v_rate_card_current`. Never store a bill rate; the multiples live in
   `ref_billing_multiple` and are themselves effective-dated.
4. **Role code, status, engagement type and pool are four independent axes.** A promotion
   changes the role code. Shelving changes the status. Going part-time changes the
   engagement. None of them touches the others.
5. **MP approval for anything off-anchor.** Any `person_rate` that is not `band_anchor`
   requires `approved_by = 'MP'` and a `deviation_reason`. Integrity rule 4 enforces it.
6. **No worse off.** No contractor rate is reduced by the FY27 transition. Integrity
   rule 5 detects any breach.

---

## 4. What the model does with each requirement

### Full-time, part-time and pool contractor

Lives in `person_engagement`, not in the job title:

- `engagement_type` — `permanent` | `contractor` | `program` | `honorary`
- `employment_basis` — `full_time` | `part_time`, permanent only
- `fte_fraction` — required for permanent, forbidden otherwise

Constraints make the invalid states unrepresentable: full-time must be exactly 1.000 FTE,
part-time must be below 1.000, and a contractor cannot carry an FTE at all.

**Salary is always stored at the 1.0 FTE figure** in `person_remuneration`, and
`v_effective_salary` multiplies by the current FTE. Moving between full-time and part-time
therefore never rewrites the salary record, and the history of what the role was worth
stays intact.

### Alumni and shelving

`person_status`, with four statuses seeded from the schema:

| Code | Meaning | `clock_accrues` |
|---|---|---|
| `ACTIVE` | Employed, or working under a live work order | yes |
| `RESERVE` | Shelved: a self-nominated or agreed pause | no |
| `ALUMNI` | Formal exit on good terms | no |
| `ADVISOR` | Held alongside the `ADV` role code | no |

`pause_mechanism` records how a pause was formalised (`unpaid_leave_role_held`,
`resignation_to_alumni`, `contractor_dormant`), because the employment consequences differ
and the distinction has to be documented at the outset.

`v_reserve_review` gives pool leads their quarterly list, including anyone past the nominal
24 months.

Migration deliberately sets everyone inactive in the legacy system to **Alumni, not
Reserve**. Reserve is a positive election by the individual and must not be assumed on
someone's behalf.

### Promotions tenure

`v_role_tenure` returns both `elapsed_days` and `active_days` for the current role.
**Only time in a status where `clock_accrues` is true counts.** Reserve pauses the clock; it
never resets it.

`v_promotion_eligibility` evaluates the gates a machine can evaluate — tenure, understudy
completion, and whether the soft maximum has passed — and surfaces the rest (contribution,
sponsorship and calibration, business need) as human decisions rather than pretending to
compute them. `v_tenure_watchlist` flags anyone within six months of the soft maximum, which
triggers a career conversation and never an automatic exit.

### Rates

`ref_rate_band` holds the FY27 cost anchor per role and geography. AU and NZ share the AUD
anchor; US and UK carry local-market rates derived from the schema multipliers. Roles not on
the cost model (`MP`, `P1`, `L3`) carry a bill override, and `ADV` is marked
`not_time_billed`.

`person_rate` holds what an individual is actually paid, with `rate_basis` distinguishing
`band_anchor`, `negotiated_in_band`, `deviation_above`, `deviation_below` and
`grandfathered`. Step M8 in file 03 performs the no-worse-off pass and
`v_rate_transition_check` reports the outcome per person.

---

## 5. Migration sequence

| Step | Action | Done when |
|---|---|---|
| M0 | Take a full backup and record legacy headcounts by role and engagement type | Backup restorable in a scratch database |
| M1 | Run files 01 and 02 | `SELECT COUNT(*) FROM ref_role` returns 17 |
| M2 | Populate `stg_legacy_personnel` from the current tables | Row count matches legacy headcount |
| M3 | Run the three preflight queries in file 03 | All three return zero rows |
| M4 | Run the rest of file 03 | Reconciliation view matches the M0 figures |
| M5 | Run file 04 | `v_integrity_exceptions` returns zero rows |
| M6 | MP reviews `v_rate_transition_check` and resolves OD-1 | Every `below_anchor_review` row has a decision |
| M7 | Resolve pool lead initials to `person_id` in `ref_talent_pool` | No `lead_person_id IS NULL` |
| M8 | Point the application's reads at the views | No code reads the base tables directly for current state |
| M9 | Add `v_integrity_exceptions` to CI as a zero-row assertion | Build fails if it ever returns a row |

**Rollback.** Nothing in the legacy tables is touched, so rollback is
`DROP SCHEMA foundry CASCADE` plus reverting the application to legacy reads. Once
production writes begin against the new tables, rollback becomes a restore from the M0
backup, so treat M8 as the point of no return.

---

## 6. Tests that must pass

The package was validated against a live database. Two of these exist because the
implementation failed them first; keep them as regression tests.

1. **Tenure excludes Reserve.** A contractor in role since 2022-02-01 who shelved on
   2024-01-15 shows 1638 elapsed days and 713 active days. The difference is the Reserve
   period, to the day.
2. **Alumni accrue nothing.** An Alumni person shows elapsed days greater than zero and
   `active_days = 0`.
   *This failed first time.* PostgreSQL's `GREATEST` and `LEAST` **ignore** NULL arguments
   instead of propagating them, so an unmatched `LEFT JOIN` silently returned the full
   elapsed period, and every Alumni and Reserve person accrued full tenure and appeared
   promotion-eligible. The fix is the `CASE WHEN si.valid_from IS NULL THEN 0` guard in
   `v_role_tenure`. Do not remove it.
3. **`current_role` is a reserved word.** The eligibility view exposes
   `current_role_code`. Aliasing a column as `current_role` returns the database role name
   instead of the person's role, with no error. *This also failed first time.*
4. **Append-only holds.** `UPDATE person_role` and `DELETE FROM person_status` both raise.
5. **Engagement constraints hold.** Full-time at 0.5 FTE, permanent with no FTE, and a
   contractor carrying an FTE are all rejected. A full-time to part-time conversion at
   0.6 FTE is accepted.
6. **No worse off.** A contractor on $240 against a $210 anchor is written as
   `grandfathered` at $240. One on $150 against a $160 anchor keeps $150 and is flagged
   `below_anchor_review`.
7. **Rails are enforced.** An `E1` set up as an employee appears in
   `v_integrity_exceptions` as `engagement_not_permitted_for_role`.
8. **Effective salary.** A part-timer at 0.600 FTE on a $180,000 full-time salary returns
   $108,000, with the incentive target inherited from the role.
9. **Ambiguous legacy titles are caught, not guessed.** "Consultant (0.5 FTE)" resolves to
   no canonical code and surfaces in preflight with its review note.

---

## 7. Open decisions for the Managing Partner

- **OD-1 — contractors below the new anchor.** The migration preserves the current rate and
  flags it. It does **not** automatically raise anyone to the anchor, because "no worse off"
  means no reduction, and lifting everyone below anchor is a cost decision rather than a
  migration side effect. If automatic uplift is wanted, change the `deviation_below` branch
  in step M8 and set `meta.governance.no_worse_off` in the schema to match.
- **OD-2 — indexation.** The FY27 anchors are the FY25-26 platform rates corrected for the
  L1/L2 inversion and indexed about 5%. That figure is a proposal, not a benchmark.
- **OD-3 — Reserve beyond 24 months.** The 24 months is nominal and only produces a flag in
  `v_reserve_review`. Decide whether passing it should force a decision or stay advisory.
- **OD-4 — pool lead identities.** `ref_talent_pool.lead_ref` holds the initials TT, TT/CP,
  MB and CP from the FY27 team structure. I could not verify who these map to; resolve
  before go-live.
