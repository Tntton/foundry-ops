import { describe, it, expect } from 'vitest';
import {
  hasRole,
  hasAnyRole,
  requireRole,
  requireAnyRole,
  requireSession,
  UnauthorizedError,
  type Session,
} from '@/server/roles';

const mkSession = (roles: Session['person']['roles']): Session => ({
  person: {
    id: 'p1',
    email: 'tt@foundry.health',
    firstName: 'Trung',
    lastName: 'Tton',
    initials: 'TT',
    roles,
  },
});

describe('hasRole', () => {
  it('returns false for null session', () => {
    expect(hasRole(null, 'partner')).toBe(false);
  });

  it('returns true when person holds the role', () => {
    expect(hasRole(mkSession(['partner']), 'partner')).toBe(true);
  });

  it('returns true when person holds the role alongside others', () => {
    expect(hasRole(mkSession(['super_admin', 'partner', 'manager']), 'partner')).toBe(true);
  });

  it('returns false when person lacks the role', () => {
    expect(hasRole(mkSession(['staff']), 'super_admin')).toBe(false);
  });
});

describe('hasAnyRole', () => {
  it('returns false for null session', () => {
    expect(hasAnyRole(null, ['partner', 'admin'])).toBe(false);
  });

  it('returns true when any role matches', () => {
    expect(hasAnyRole(mkSession(['manager']), ['partner', 'manager'])).toBe(true);
  });

  it('returns false when no roles match', () => {
    expect(hasAnyRole(mkSession(['staff']), ['partner', 'admin', 'super_admin'])).toBe(false);
  });

  it('returns false for empty required list', () => {
    expect(hasAnyRole(mkSession(['super_admin']), [])).toBe(false);
  });
});

describe('requireSession', () => {
  it('throws UnauthorizedError when session is null', () => {
    expect(() => requireSession(null)).toThrow(UnauthorizedError);
  });

  it('does not throw for a valid session', () => {
    expect(() => requireSession(mkSession(['staff']))).not.toThrow();
  });
});

describe('requireRole', () => {
  it('throws when session is null', () => {
    expect(() => requireRole(null, 'partner')).toThrow(UnauthorizedError);
  });

  it('throws when person lacks the role', () => {
    expect(() => requireRole(mkSession(['staff']), 'super_admin')).toThrow(UnauthorizedError);
  });

  it('does not throw when person has the role', () => {
    expect(() => requireRole(mkSession(['super_admin']), 'super_admin')).not.toThrow();
  });
});

describe('requireAnyRole', () => {
  it('throws when no role matches', () => {
    expect(() => requireAnyRole(mkSession(['staff']), ['partner', 'admin'])).toThrow(
      UnauthorizedError,
    );
  });

  it('does not throw when any role matches', () => {
    expect(() =>
      requireAnyRole(mkSession(['manager']), ['partner', 'manager']),
    ).not.toThrow();
  });
});
