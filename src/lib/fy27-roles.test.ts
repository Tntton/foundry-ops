import { describe, it, expect } from 'vitest';
import { FOUNDRY_LEVELS } from './levels';
import {
  FY27_BANDS,
  FY27_ROLES,
  ROLE_CODES,
  bandForRoleCode,
  titleForRoleCode,
  poolForRoleCode,
  isLeadershipRoleCode,
  isLeadershipBandCode,
  legacyLevelToRoleCode,
  roleMeta,
  type RoleCode,
  type BandCode,
} from './fy27-roles';

describe('FY27 reference data', () => {
  it('carries all 18 roles (17 delivered + OM) and 9 bands (8 + OPERATIONS)', () => {
    expect(FY27_ROLES).toHaveLength(18);
    expect(FY27_BANDS).toHaveLength(9);
    expect(FY27_ROLES.map((r) => r.code)).toContain('OM');
    expect(FY27_BANDS.map((b) => b.code)).toContain('OPERATIONS');
  });

  it('OM (Office Manager) sits on the OPERATIONS band, not incentive-eligible', () => {
    const om = roleMeta('OM');
    expect(om?.bandCode).toBe('OPERATIONS');
    expect(om?.incentiveTargetPct).toBeNull();
    expect(om?.permitsPermanent).toBe(true);
  });

  it('ROLE_CODES is sorted by seniority, MP first', () => {
    expect(ROLE_CODES[0]).toBe('MP');
    expect(ROLE_CODES).toContain('P1');
  });
});

describe('band derivation', () => {
  // The band moves that bite: L1/L2 leave Consultant for LEADERSHIP, the
  // fellows leave Consultant for FELLOW, the intern leaves Analyst for INTERN.
  const cases: Array<[RoleCode, BandCode]> = [
    ['MP', 'PARTNERSHIP'],
    ['P1', 'PARTNERSHIP'],
    ['L3', 'LEADERSHIP'],
    ['L2', 'LEADERSHIP'],
    ['L1', 'LEADERSHIP'],
    ['T3', 'CONSULTANT'],
    ['T1', 'CONSULTANT'],
    ['A1', 'ANALYST'],
    ['E1', 'EXPERT'],
    ['E2', 'EXPERT'],
    ['F1', 'FELLOW'],
    ['F2', 'FELLOW'],
    ['ADV', 'ADVISOR'],
    ['I0', 'INTERN'],
    ['OM', 'OPERATIONS'],
  ];
  it.each(cases)('%s → %s', (code, band) => {
    expect(bandForRoleCode(code)).toBe(band);
  });
});

describe('legacy level-code crosswalk', () => {
  // Every level code the current app carries must resolve to a FY27 role code.
  const expected: Record<string, RoleCode> = {
    L4: 'P1', // rename
    L3: 'L3',
    L2: 'L2',
    L1: 'L1',
    E2: 'E2',
    E1: 'E1',
    F2: 'F2',
    F1: 'F1',
    T3: 'T3',
    T2: 'T2',
    T1: 'T1',
    A3: 'A3',
    A2: 'A2',
    A1: 'A1',
    IO: 'I0', // rename (letter-O → zero)
    OM: 'OM',
  };

  it('resolves every FOUNDRY_LEVELS code with no gaps', () => {
    for (const lvl of FOUNDRY_LEVELS) {
      const got = legacyLevelToRoleCode(lvl.code);
      expect(got, `level ${lvl.code}`).toBe(expected[lvl.code]);
    }
  });

  it('applies the two renames explicitly', () => {
    expect(legacyLevelToRoleCode('L4')).toBe('P1');
    expect(legacyLevelToRoleCode('IO')).toBe('I0');
  });

  it('is case- and whitespace-insensitive and accepts already-canonical codes', () => {
    expect(legacyLevelToRoleCode(' l4 ')).toBe('P1');
    expect(legacyLevelToRoleCode('i0')).toBe('I0');
    expect(legacyLevelToRoleCode('P1')).toBe('P1');
  });

  it('returns null for unknown values rather than guessing', () => {
    expect(legacyLevelToRoleCode('L9')).toBeNull();
    expect(legacyLevelToRoleCode('')).toBeNull();
    expect(legacyLevelToRoleCode(null)).toBeNull();
  });
});

describe('leadership predicate (generalised — now includes L1/L2)', () => {
  it('treats MP/P1/L3/L2/L1 as leadership', () => {
    for (const code of ['MP', 'P1', 'L3', 'L2', 'L1']) {
      expect(isLeadershipRoleCode(code), code).toBe(true);
    }
  });

  it('excludes the delivery ladder and off-pyramid roles', () => {
    for (const code of ['T3', 'T1', 'A1', 'E1', 'F1', 'ADV', 'I0', 'OM']) {
      expect(isLeadershipRoleCode(code), code).toBe(false);
    }
  });

  it('band-code predicate matches', () => {
    expect(isLeadershipBandCode('PARTNERSHIP')).toBe(true);
    expect(isLeadershipBandCode('LEADERSHIP')).toBe(true);
    expect(isLeadershipBandCode('CONSULTANT')).toBe(false);
    expect(isLeadershipBandCode(null)).toBe(false);
  });
});

describe('talent pool derivation', () => {
  it('maps role codes to pools, null for MP/P1/OM', () => {
    expect(poolForRoleCode('L2')).toBe('POOL_APM');
    expect(poolForRoleCode('T2')).toBe('POOL_CONSULT');
    expect(poolForRoleCode('E1')).toBe('POOL_EXPFEL');
    expect(poolForRoleCode('ADV')).toBe('POOL_EXPFEL');
    expect(poolForRoleCode('A2')).toBe('POOL_ANALYST');
    expect(poolForRoleCode('I0')).toBe('POOL_ANALYST');
    expect(poolForRoleCode('MP')).toBeNull();
    expect(poolForRoleCode('P1')).toBeNull();
    expect(poolForRoleCode('OM')).toBeNull();
  });
});

describe('titles', () => {
  it('resolves canonical titles', () => {
    expect(titleForRoleCode('P1')).toBe('Partner');
    expect(titleForRoleCode('T3')).toBe('Senior Consultant');
    expect(titleForRoleCode('OM')).toBe('Office Manager');
  });
});
