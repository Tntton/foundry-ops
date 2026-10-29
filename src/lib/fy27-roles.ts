/**
 * FY27 role architecture — canonical taxonomy for Foundry Ops.
 *
 * The reference data (bands, role codes, pools) is generated from the
 * source-of-truth schema at `docs/fy27-migration/foundry_roles_schema.json`
 * into `./fy27-roles.generated.ts` (run `node scripts/gen-fy27-roles.mjs`).
 * This file adds the TypeScript types, the legacy → canonical crosswalk, and
 * the lookup helpers the app consumes.
 *
 * See FY27_ROLE_ARCHITECTURE.md for the full crosswalk table and decisions.
 * NB: FY27 *role codes* are HR taxonomy — a separate axis from the access
 * `Role` enum (super_admin/admin/…/staff). Do not conflate them.
 */
import { FY27_BANDS, FY27_ROLES, FY27_POOL_ROLES } from './fy27-roles.generated';

export { FY27_BANDS, FY27_ROLES, FY27_POOL_ROLES } from './fy27-roles.generated';
export { FY27_SCHEMA_VERSION, FY27_EFFECTIVE_FROM } from './fy27-roles.generated';

/** Canonical FY27 role codes (17 delivered + `OM` firm-internal extension). */
export type RoleCode = (typeof FY27_ROLES)[number]['code'];
/** Canonical FY27 band codes (8 delivered + `OPERATIONS` extension). */
export type BandCode = (typeof FY27_BANDS)[number]['code'];

/** How a person is engaged. Replaces the binary `Employment` (ft/contractor). */
export type EngagementType = 'permanent' | 'contractor' | 'program' | 'honorary';
/** Permanent-only sub-axis. */
export type EmploymentBasis = 'full_time' | 'part_time';
/** Workforce-status lifecycle, orthogonal to role code. */
export type WorkforceStatusCode = 'ACTIVE' | 'RESERVE' | 'ALUMNI' | 'ADVISOR';
/** Talent pools (derived from role code). */
export type PoolCode = 'POOL_APM' | 'POOL_CONSULT' | 'POOL_EXPFEL' | 'POOL_ANALYST';

export type RoleMeta = (typeof FY27_ROLES)[number];
export type BandMeta = (typeof FY27_BANDS)[number];

const ROLE_BY_CODE: ReadonlyMap<string, RoleMeta> = new Map(FY27_ROLES.map((r) => [r.code, r]));
const BAND_BY_CODE: ReadonlyMap<string, BandMeta> = new Map(FY27_BANDS.map((b) => [b.code, b]));

/** All canonical role codes, in seniority order (highest rank first). */
export const ROLE_CODES: readonly RoleCode[] = [...FY27_ROLES]
  .sort((a, b) => b.seniorityRank - a.seniorityRank)
  .map((r) => r.code);

export function isRoleCode(value: string): value is RoleCode {
  return ROLE_BY_CODE.has(value);
}

export function roleMeta(code: string): RoleMeta | undefined {
  return ROLE_BY_CODE.get(code);
}

export function bandMeta(code: string): BandMeta | undefined {
  return BAND_BY_CODE.get(code);
}

/** Band code for a role code (e.g. `L2` → `LEADERSHIP`). */
export function bandForRoleCode(code: string): BandCode | undefined {
  return ROLE_BY_CODE.get(code)?.bandCode as BandCode | undefined;
}

/** Display title for a role code (e.g. `T3` → `Senior Consultant`). */
export function titleForRoleCode(code: string): string {
  return ROLE_BY_CODE.get(code)?.title ?? code;
}

/**
 * The leadership tier under FY27 = the PARTNERSHIP and LEADERSHIP bands, i.e.
 * MP, P1, L3, L2, L1. This is the generalised replacement for the legacy
 * `isLeadershipBand()` (which pre-dated L1/L2 moving up from the Consultant
 * band). Consumers get rewired to this in TASK-408.
 */
export const LEADERSHIP_BANDS: readonly BandCode[] = ['PARTNERSHIP', 'LEADERSHIP'];

export function isLeadershipBandCode(band: string | null | undefined): boolean {
  return band === 'PARTNERSHIP' || band === 'LEADERSHIP';
}

export function isLeadershipRoleCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return isLeadershipBandCode(bandForRoleCode(code));
}

const POOL_BY_ROLE: ReadonlyMap<string, PoolCode> = new Map(
  FY27_POOL_ROLES.map((pr) => [pr.roleCode, pr.poolCode as PoolCode]),
);

/** Talent pool for a role code, or null for MP/P1 (LT/Partnership) and OM. */
export function poolForRoleCode(code: string): PoolCode | null {
  return POOL_BY_ROLE.get(code) ?? null;
}

/**
 * App-level legacy crosswalk: the current `Person.level` code → FY27 role code.
 * Mostly identity; the only renames are `L4 → P1` (Partner) and `IO → I0`
 * (Intern; letter-O to zero). `OM` maps to itself (the OPERATIONS extension).
 * Distinct from the document-level `RefRoleCodeMap` in the schema JSON, which
 * resolves heterogeneous legacy *labels* per source for the SQL backfill.
 * See FY27_ROLE_ARCHITECTURE.md §3a.
 */
const LEVEL_CODE_RENAMES: Readonly<Record<string, RoleCode>> = {
  L4: 'P1',
  IO: 'I0',
};

/**
 * Resolve a current app level code to its FY27 role code. Returns null when
 * the value is not a recognised level/role code (caller should surface it for
 * review rather than guessing).
 */
export function legacyLevelToRoleCode(level: string | null | undefined): RoleCode | null {
  if (!level) return null;
  const norm = level.trim().toUpperCase();
  const renamed = LEVEL_CODE_RENAMES[norm];
  if (renamed) return renamed;
  return isRoleCode(norm) ? (norm as RoleCode) : null;
}
