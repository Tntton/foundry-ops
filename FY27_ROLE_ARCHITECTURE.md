# FY27 Role Architecture — personnel taxonomy migration

**Status:** planning / prep. Schema is `2.3-draft`, `PENDING_MP_SIGNOFF`, effective `2026-07-01`.
**Owner decision date:** 2026-07-28 (TT).
**Source package:** [`docs/fy27-migration/`](docs/fy27-migration/) — the four `.sql` files, `foundry_roles_schema.json` (source of truth), `generate_seed.py`, and `README_MIGRATION_BRIEF.md`.

This document is the bridge between the delivered FY27 migration package (raw-Postgres, append-only, effective-dated, derived-view design) and the Foundry Ops codebase (Next.js + Prisma, flat mutable `Person`). The build tasks live in `TASKS.md` **Phase 7**; this file is their shared reference. Do not run the four `.sql` files against the Prisma-owned database — they are the *spec*, ported into Prisma migrations by the Phase 7 tasks.

---

## 1. Decisions (TT, 2026-07-28)

| # | Decision | Choice |
|---|----------|--------|
| D1 | **Data model** | **Hybrid.** Keep `Person` as the current-state record. Add effective-dated *dimension* tables for the axes that need history (role, status, engagement, rate). Adopt FY27 *reference* tables (bands, 17 role codes, statuses, pools, rate bands) as canonical. Preserves the ~44 existing consumers; honours append-only where it matters. |
| D2 | **Scope for go-live** (target ~2026-04-24) | **Phased MVP.** Phase 1 = taxonomy + person edit / directory / rate-card / CSV-import surfaces + the data backfill. **Defer** promotion tenure clock, understudy gates, incentive framework, and credential modifiers to post-go-live tasks. |
| D3 | **Office Manager / `Support_Staff`** | **Add a new FY27 code.** New band `OPERATIONS`, role code `OM` (Office Manager). Off the delivery ladder — not time-billed, no progression, not incentive-eligible. Encoded in the repo copy of `foundry_roles_schema.json` (MP-approved extension to 2.3-draft). |
| D4 | **Rate model** | **Adopt FY27 rate bands.** Store cost anchor only; derive bill ×2 / ×3; add geo (AU/NZ/US/UK); record person-level deviations with the no-worse-off rule + MP approval. Extends the existing `RateCard`. |

---

## 2. The two models, side by side

**Current (flat `Person`)** — one mutable row per person:
`band` (7-value enum), `level` (free string, 16 codes), `employment` (`ft`/`contractor`), `fte`, `isStaff`, `isFullPartner`, `roles` (access enum — a *separate* axis), `rate`/`billRate`/`expertRate`, lifecycle = `inactiveAt` + `endDate` + `poolStatusOverride` pip. Rates in a flat `RateCard` keyed on level code.

**FY27 package** — append-only, effective-dated dimension tables (`person_role`, `person_status`, `person_engagement`, `person_rate`, `person_pool`, `person_credential`, `incentive_award`); current state *derived in views*; 8 bands / 17 role codes; four engagement types; a real workforce-status lifecycle; talent pools; credential modifiers; a promotion tenure clock; cost-only rates with bill derived ×2/×3 across four geos.

**Hybrid target (D1)** — reference taxonomy + dimension tables from FY27, with `Person` retained as the identity + denormalised "current" cache that the dimension tables write through. Reads that only need current state keep hitting `Person`; anything that needs history reads the dimension tables (or a `v_person_current`-equivalent Prisma view/query).

> **Keep two axes separate.** FY27 *role codes* (`MP`,`P1`,`L3`,…,`OM`) are HR taxonomy. The existing `Role` enum (`super_admin`/`admin`/`partner`/`associate_partner`/`manager`/`staff`) is the **access/capability** axis and stays as-is. Do not conflate them; a person has both a role code and one-or-more access roles.

---

## 3. Taxonomy crosswalk (current → FY27)

### 3a. Level code → role code + band

| Current `level` | Current `band` | → FY27 role code | → FY27 band | Notes |
|---|---|---|---|---|
| `MP` | `MP` | `MP` | `PARTNERSHIP` | Managing Partner (TT). |
| `L4` | `Partner` | **`P1`** | `PARTNERSHIP` | **Code rename** L4→P1. |
| `L3` | `Associate_Partner` | `L3` | **`LEADERSHIP`** | Band move. |
| `L2` | `Consultant` | `L2` | **`LEADERSHIP`** | **Band move** — was Consultant. |
| `L1` | `Consultant` | `L1` | **`LEADERSHIP`** | **Band move** — was Consultant. |
| `E2` | `Expert` | `E2` | `EXPERT` | |
| `E1` | `Expert` | `E1` | `EXPERT` | |
| `F2` | `Consultant` | `F2` | **`FELLOW`** | **Band move** — Fellow becomes its own band. |
| `F1` | `Consultant` | `F1` | **`FELLOW`** | **Band move.** |
| `T3` | `Consultant` | `T3` | `CONSULTANT` | |
| `T2` | `Consultant` | `T2` | `CONSULTANT` | |
| `T1` | `Consultant` | `T1` | `CONSULTANT` | |
| `A3` | `Analyst` | `A3` | `ANALYST` | |
| `A2` | `Analyst` | `A2` | `ANALYST` | |
| `A1` | `Analyst` | `A1` | `ANALYST` | |
| `IO` | `Analyst` | **`I0`** | **`INTERN`** | **Code rename** IO→I0 (letter-O → zero) + band move. |
| `OM` | `Support_Staff` | `OM` | **`OPERATIONS`** | New band+code (D3). |
| — | — | `ADV` | `ADVISOR` | New role — no current holders; destination for senior alumni. |

`Person.level` is a **free string**, so no value auto-migrates — the backfill (TASK-403) rewrites every row through this table plus the legacy map in `foundry_roles_schema.json`.

### 3b. Employment → engagement

| Current `employment` | + signal | → FY27 `engagement_type` | `employment_basis` | `fte_fraction` |
|---|---|---|---|---|
| `ft` | `fte == 1.0` | `permanent` | `full_time` | 1.000 |
| `ft` | `fte < 1.0` | `permanent` | `part_time` | = fte |
| `contractor` | — | `contractor` | *(null)* | *(null)* |
| *(intern, role `I0`)* | — | `program` | *(null)* | *(null)* |
| *(advisor, role `ADV`)* | — | `honorary` or `contractor` | *(null)* | *(null)* |

Constraint parity: permanent must carry basis + FTE (full_time ⇒ exactly 1.000); non-permanent must not.

### 3c. Lifecycle → workforce status

| Current signal | → FY27 `status_code` | Notes |
|---|---|---|
| `endDate == null && inactiveAt == null` | `ACTIVE` | |
| `endDate != null` (archived) | `ALUMNI` | Per brief: legacy exits become Alumni, never Reserve (Reserve is a positive election). |
| `inactiveAt != null` (soft pause) | **REVIEW → `RESERVE`?** | In *this* app `inactiveAt` is already an explicit reversible pause, so it maps well to Reserve — but the brief warns against assuming Reserve. **Backfill per-person, MP-confirmed.** |
| role `ADV` | `ADVISOR` (held concurrently) | |
| `poolStatusOverride == on_sabbatical` | informs RESERVE | Advisory pip today; decide whether the new status axis *replaces* or *supplements* `poolStatusOverride`. |

### 3d. Talent pool (derived from role code)

`POOL_APM` = L3/L2/L1 · `POOL_CONSULT` = T1–T3 · `POOL_EXPFEL` = E1/E2/F1/F2/ADV · `POOL_ANALYST` = A1–A3/I0. `MP`/`P1` sit in LT/Partnership (no pool); `OM` sits in Operations (no delivery pool). Pool-lead initials (TT, TT/CP, MB, CP) resolve to `person_id` — see brief OD-4.

---

## 4. Consumer surfaces that must change (from the codebase audit)

- **Enums / validators (Prisma + Zod + hardcoded arrays):** `prisma/schema.prisma` (`Band`, `Employment`, new status/engagement/pool); `src/lib/levels.ts` (`LevelCode`, `FOUNDRY_LEVELS`); hardcoded `BANDS`/`EMPLOYMENTS`/`ROLES` in `directory/people/new/actions.ts`, `directory/people/[id]/edit/{form,actions}.tsx`, `src/server/imports/personnel.ts`.
- **`isLeadershipBand()`** (`src/lib/levels.ts:88`) — a hardcoded 3-value check that will silently mis-classify L1/L2 once they move to LEADERSHIP. Used by the project primary-partner picker, availability/resource-planning capacity=0 rule, and the import FTE gate. **Generalise to a band predicate driven by the reference table.**
- **Off-pyramid handling** is wired only for `Support_Staff` literally: `availability.ts:208`, `resource-planning.ts:159`, `availability/page.tsx:281`, `manager-dashboard.ts:418`, `resource-planning/page.tsx:53`, `edit/actions.ts:166`, `edit/form.tsx:72`. FELLOW/ADVISOR/INTERN/OPERATIONS must be classified explicitly or they wrongly count toward capacity/utilisation.
- **Rate card:** `src/server/rate-card.ts` (`ORDER`, `currentRatesByCode`), `admin/rate-card/*` (`ROLE_LABELS` display bands), `RateCard` model (add geo; keep cost, derive bill).
- **Import + template:** `src/server/imports/personnel.ts` (+ its golden test `src/__tests__/import-personnel.test.ts`), `public/templates/personnel-template.csv`, `admin/import/personnel/page.tsx`. Note the pre-existing bug: importer restricts `region` to `AU`/`NZ` while `Person.region` accepts any ISO code — fold the fix in here.
- **Seed:** `prisma/seed.ts` (`mapBand`, `mapEmployment`, `rolesForPerson`, `seedRateCard`) + `prisma/fixtures/*.json` + root `foundry-team.jsx` / `foundry-ratecard.jsx` reference data.

---

## 5. Non-negotiables carried over from the brief

1. **Append-only** on the new dimension tables — no update/delete of a domain row; a change is a new effective-dated row; corrections carry `change_reason = 'correction'` + `supersedes_id`. In Prisma this is enforced app-side (there is no `foundry` schema trigger); the write path is the only door, so it must be the guardrail.
2. **Store cost, derive bill** (×2 / ×3 from `ref_billing_multiple`). Never store a bill rate.
3. **Four independent axes** — role code, status, engagement, pool. A promotion touches only the role code; shelving only the status; going part-time only the engagement.
4. **MP approval for anything off-anchor** — any `person_rate` not `band_anchor` needs `approved_by = MP` + a `deviation_reason`.
5. **No worse off** — no contractor rate is reduced by the FY27 transition; above-anchor rates are preserved as `grandfathered`; below-anchor rates are kept unchanged and flagged for MP review (open decision OD-1).
6. **Audit every mutation** (A9) — dimension writes get an `AuditEvent` in the same transaction.

---

## 6. Decisions + still-open items

**Resolved (TT, 2026-07-28):**
- **OD-1 — contractors below the new anchor: PRESERVE-AND-FLAG.** No auto-uplift. Keep the current rate unchanged, record it as `deviation_below`, and flag it for MP review at the next work order. Lifting anyone to anchor is a separate, deliberate cost decision — never a migration side effect. (Matches the backfill default; `meta.governance.no_worse_off` in the schema stays as written.)
- **Below-anchor classification must be VISIBLE on the resourcing tab (`/resource-planning`).** Partners need to see at a glance when a person has moved into the below-anchor (flagged-for-review) classification — see **TASK-410**. Rendered as a badge/pip on the `PoolChip`, with a filter/summary count.
- **`inactiveAt` → status classification: APPROACH AGREED.** Do not auto-classify soft-paused people as RESERVE; TASK-403 flags each for per-person MP confirmation during backfill (Reserve is a positive election).

**Still open:**
- Whether the new status axis **replaces or supplements** `poolStatusOverride` / `inactiveAt` (decide during TASK-405 so the resourcing pip isn't double-encoded).
- **OD-4 / pool leads** — resolve TT, TT/CP, MB, CP to `person_id`.
- Whether the Prisma `Employment` enum is **replaced** by `engagement_type` or kept as a derived shim during the transition (affects churn across the binary `=== 'contractor'` branches).
