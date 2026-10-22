import { describe, it, expect } from 'vitest';
import type { Role, Band } from '@prisma/client';
import type { Session } from '@/server/roles';
import {
  canActOnBehalfForAvailability,
  AVAILABILITY_ON_BEHALF_ROLES,
} from '@/server/availability-access';

const mkSession = (roles: Role[], band: Band = 'Consultant'): Session => ({
  person: {
    id: 'p1',
    email: 'x@foundry.health',
    firstName: 'X',
    lastName: 'Y',
    initials: 'XY',
    roles,
    headshotUrl: null,
    band,
  },
  realRoles: roles,
  isRealSuperAdmin: roles.includes('super_admin'),
  viewAsRoles: null,
});

describe('availability on-behalf access', () => {
  it('grants manager the same access as admin (TT, 2026-10-23)', () => {
    expect(canActOnBehalfForAvailability(mkSession(['manager']))).toBe(true);
    expect(canActOnBehalfForAvailability(mkSession(['admin']))).toBe(true);
  });

  it('grants associate_partner, which every prior check omitted', () => {
    expect(
      canActOnBehalfForAvailability(mkSession(['associate_partner'])),
    ).toBe(true);
  });

  it('grants super_admin and partner', () => {
    expect(canActOnBehalfForAvailability(mkSession(['super_admin']))).toBe(true);
    expect(canActOnBehalfForAvailability(mkSession(['partner']))).toBe(true);
  });

  it('keeps plain staff self-only', () => {
    expect(canActOnBehalfForAvailability(mkSession(['staff']))).toBe(false);
  });

  it('denies an unauthenticated session', () => {
    expect(canActOnBehalfForAvailability(null)).toBe(false);
  });

  it('denies Support_Staff even when they hold admin', () => {
    // The Office Manager carries `admin` for ops work but the bandwidth
    // surfaces are delivery-side — nav hides them via denyBands and the
    // server must agree.
    expect(
      canActOnBehalfForAvailability(mkSession(['admin'], 'Support_Staff')),
    ).toBe(false);
    expect(
      canActOnBehalfForAvailability(
        mkSession(['super_admin'], 'Support_Staff'),
      ),
    ).toBe(false);
  });

  it('matches the /resource-planning role gate exactly', () => {
    expect([...AVAILABILITY_ON_BEHALF_ROLES].sort()).toEqual(
      ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'].sort(),
    );
  });
});
