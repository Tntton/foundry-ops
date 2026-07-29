#!/usr/bin/env python3
"""
Regenerate 02_foundry_ops_seed_fy27.sql from the canonical role schema.

The schema file is the single source of truth. Never hand-edit the seed SQL:
change foundry_roles_schema.json and re-run this script, so the platform,
the position descriptions and the deck cannot drift apart.

Usage:  python3 generate_seed.py ../foundry_roles_schema.json 02_foundry_ops_seed_fy27.sql
"""
import json
import re
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "foundry_roles_schema.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else "02_foundry_ops_seed_fy27.sql"

s = json.load(open(SRC, encoding="utf-8"))
meta = s["meta"]
EFF = meta["effective_from"]                 # '2026-07-01'
VER = meta["version"]
geo = meta["geo_rates"]
bm = meta["billing_model"]

STATUS_CODE = {
    "Active": "ACTIVE",
    "Inactive (Reserve)": "RESERVE",
    "Alumni": "ALUMNI",
    "Advisor": "ADVISOR",
}
POOL_CODE = {
    "Associate Partner / Manager Pool": "POOL_APM",
    "Consultant Pool": "POOL_CONSULT",
    "Expert / Fellow Pool": "POOL_EXPFEL",
    "Analyst Pool": "POOL_ANALYST",
}


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def target_pct(role):
    """Incentive target from the role's incentive text; NULL if not eligible."""
    txt = role.get("incentive", "") or ""
    if "not incentive-eligible" in txt.lower() or "not applicable" in txt.lower():
        return None
    m = re.search(r"(\d+)\s*%", txt)
    return int(m.group(1)) if m else None


L = []
w = L.append
w("-- ===========================================================================")
w("-- Foundry Ops : FY27 reference data")
w("-- File 2 of 4 : seed (GENERATED - do not hand-edit)")
w(f"-- Generated from : {SRC}   schema version {VER}")
w(f"-- Effective from : {EFF}")
w("--")
w("-- Re-runnable. Inserts are effective-dated, so re-running with a newer")
w("-- schema version ADDS rows rather than replacing them, per append-only.")
w("-- ===========================================================================")
w("")
w("BEGIN;")
w("SET search_path TO foundry, public;")
w("")

# --- billing multiples ---
w("-- Billing multiples (bill rates are derived from cost, never stored)")
w("INSERT INTO ref_billing_multiple (bill_low_multiple, bill_high_multiple, effective_from, schema_version)")
w(f"VALUES ({bm['bill_low_multiple']}, {bm['bill_high_multiple']}, {q(EFF)}, {q(VER)})")
w("ON CONFLICT (effective_from) DO NOTHING;")
w("")

# --- bands ---
w("-- Bands")
w("INSERT INTO ref_band (band_code, band_name, notes, effective_from, schema_version) VALUES")
rows = [f"  ({q(b['band'].upper().replace(' ', '_'))}, {q(b['band'])}, {q(b.get('notes'))}, {q(EFF)}, {q(VER)})"
        for b in s["bands"]]
w(",\n".join(rows))
w("ON CONFLICT (band_code, effective_from) DO NOTHING;")
w("")

# --- roles ---
w("-- Roles")
w("INSERT INTO ref_role (role_code, title, band_code, seniority_rank, dual_pathway,")
w("  permits_permanent, permits_contractor, permits_program, permits_honorary,")
w("  remuneration_model, incentive_target_pct, notes, effective_from, schema_version) VALUES")
rows = []
for r in s["roles"]:
    et = r["engagement_types"]
    rows.append(
        "  ({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})".format(
            q(r["code"]), q(r["title"]), q(r["band"].upper().replace(" ", "_")),
            r["seniority_rank"], q(bool(r.get("dual_pathway"))),
            q("permanent" in et or "equity_partner" in et),
            q("contractor" in et), q("program" in et), q("honorary" in et),
            q(r["remuneration_model"]), q(target_pct(r)), q(r.get("notes")),
            q(EFF), q(VER)))
w(",\n".join(rows))
w("ON CONFLICT (role_code, effective_from) DO NOTHING;")
w("")

# --- rate bands per geography ---
w("-- Rate bands by geography. AU and NZ share the AUD anchor;")
w("-- US and UK are local-market rates derived from the multipliers in schema meta.")
w("INSERT INTO ref_rate_band (role_code, geo, currency, rate_basis, cost_hr,")
w("  bill_low_override, bill_high_override, effective_from, schema_version) VALUES")
rows = []
for r in s["roles"]:
    cost = r.get("cost_hr_aud")
    bl, bh = r.get("bill_low_aud"), r.get("bill_high_aud")
    for g, gi in geo.items():
        if cost is not None:
            c = round(cost * gi["multiplier"]) if g in ("US", "UK") else cost
            rows.append("  ({}, {}, {}, 'cost_derived', {}, NULL, NULL, {}, {})".format(
                q(r["code"]), q(g), q(gi["currency"]), c, q(EFF), q(VER)))
        elif bl is not None and g in ("AU", "NZ"):
            rows.append("  ({}, {}, {}, 'bill_override', NULL, {}, {}, {}, {})".format(
                q(r["code"]), q(g), q(gi["currency"]), bl, bh, q(EFF), q(VER)))
        elif bl is None and cost is None and g in ("AU", "NZ"):
            rows.append("  ({}, {}, {}, 'not_time_billed', NULL, NULL, NULL, {}, {})".format(
                q(r["code"]), q(g), q(gi["currency"]), q(EFF), q(VER)))
w(",\n".join(rows))
w("ON CONFLICT (role_code, geo, effective_from) DO NOTHING;")
w("")

# --- workforce statuses ---
w("-- Workforce statuses. clock_accrues drives the tenure calculation.")
w("INSERT INTO ref_workforce_status (status_code, status_name, clock_accrues, systems_access,")
w("  description, effective_from, schema_version) VALUES")
rows = []
for st in s["workforce_status"]["statuses"]:
    code = STATUS_CODE[st["status"]]
    rows.append("  ({}, {}, {}, {}, {}, {}, {})".format(
        q(code), q(st["status"]), q(code == "ACTIVE"), q(code == "ACTIVE"),
        q(st["definition"]), q(EFF), q(VER)))
w(",\n".join(rows))
w("ON CONFLICT (status_code, effective_from) DO NOTHING;")
w("")

# --- promotion steps ---
w("-- Permanent-track promotion steps. Contractor progression is credential-driven")
w("-- and has no tenure rule, so no contractor rows are seeded.")
w("INSERT INTO ref_promotion_step (from_role_code, to_role_code, track, min_months,")
w("  typical_min_months, typical_max_months, max_months, understudy_required,")
w("  qualification_gate, business_need_gate, effective_from, schema_version) VALUES")
rows = []
for st in s["promotion_pathways"]["permanent_track"]["steps"]:
    tmin = tmax = None
    m = re.match(r"(\d+)\D+(\d+)", str(st.get("typical_months", "")))
    if m:
        tmin, tmax = int(m.group(1)), int(m.group(2))
    bng = st["to"] in ("L3", "P1")
    rows.append("  ({}, {}, 'permanent', {}, {}, {}, {}, {}, {}, {}, {}, {})".format(
        q(st["from"]), q(st["to"]), q(st.get("min_months")), q(tmin), q(tmax),
        q(st.get("max_months")), q(bool(st.get("understudy"))),
        q(st.get("qualification_gate")), q(bng), q(EFF), q(VER)))
w(",\n".join(rows))
w("ON CONFLICT (from_role_code, to_role_code, track, effective_from) DO NOTHING;")
w("")

# --- talent pools ---
w("-- Talent pools. lead_ref holds the initials from the FY27 team structure;")
w("-- resolve to lead_person_id during migration step M4.")
w("INSERT INTO ref_talent_pool (pool_code, pool_name, lead_ref, effective_from, schema_version) VALUES")
rows = [f"  ({q(POOL_CODE[p['pool']])}, {q(p['pool'])}, {q(p['lead_initials'])}, {q(EFF)}, {q(VER)})"
        for p in s["team_structure"]["talent_pools"]]
w(",\n".join(rows))
w("ON CONFLICT (pool_code, effective_from) DO NOTHING;")
w("")

w("-- Which role codes sit in which pool")
w("INSERT INTO ref_pool_role (pool_code, role_code, effective_from) VALUES")
rows = []
for p in s["team_structure"]["talent_pools"]:
    for c in p["codes"]:
        rows.append(f"  ({q(POOL_CODE[p['pool']])}, {q(c)}, {q(EFF)})")
w(",\n".join(rows))
w("ON CONFLICT (pool_code, role_code, effective_from) DO NOTHING;")
w("")

# --- credential types ---
w("-- Credential modifiers. These attach to a person and position the rate")
w("-- within band. They never change the role code.")
w("INSERT INTO ref_credential_type (credential_key, allowed_values, affects_rate,")
w("  triggers_supervision, description) VALUES")
rows = []
for m in s["credential_modifiers"]["modifiers"]:
    vals = m["values"]
    arr = ("ARRAY[" + ",".join(q(v) for v in vals) + "]") if isinstance(vals, list) else "NULL"
    trig = "registration" in m["key"]
    rows.append(f"  ({q(m['key'])}, {arr}, true, {q(trig)}, {q(m['implication'])})")
w(",\n".join(rows))
w("ON CONFLICT (credential_key) DO NOTHING;")
w("")

# --- legacy code map (machine-readable; identity rows included) ---
cm = s["code_migration"]
w("-- Legacy label to canonical code. Applied once in migration step M4.")
w("-- Identity rows are included so unchanged codes resolve too; rows with")
w("-- requires_review = true must be resolved with the MP before migrating.")
w("INSERT INTO ref_role_code_map (legacy_label, legacy_source, canonical_role_code, requires_review, review_note) VALUES")
rows, seen = [], set()
def add(label, source, code, review=False, note=None):
    k = (label.lower(), source)
    if k in seen:
        return
    seen.add(k)
    rows.append(f"  ({q(label)}, {q(source)}, {q(code)}, {q(review)}, {q(note)})")
for r in s["roles"]:                       # identity: bare code and 'Title (CODE)'
    add(r["code"], "platform", r["code"])
    add(f"{r['title']} ({r['code']})", "platform", r["code"])
for r in cm["renames"]:
    add(r["legacy_label"], r["legacy_source"], r["canonical_role_code"])
for r in cm["requires_review"]:
    add(r["legacy_label"], r["legacy_source"], None, True, r["note"])
w(",\n".join(rows))
w("ON CONFLICT (legacy_label, legacy_source) DO NOTHING;")
w("")
w("COMMIT;")

open(OUT, "w", encoding="utf-8").write("\n".join(L) + "\n")
print(f"wrote {OUT} ({len(L)} lines) from schema version {VER}")
