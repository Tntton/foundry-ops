import { describe, it, expect } from 'vitest';
import type { Role } from '@prisma/client';
import {
  hasCapability,
  requireCapability,
  CAPABILITY_ROLES,
  type Capability,
} from '@/server/capabilities';
import { UnauthorizedError, type Session } from '@/server/roles';

const mkSession = (roles: Role[]): Session => ({
  person: {
    id: 'p1',
    email: 'x@foundry.health',
    firstName: 'X',
    lastName: 'Y',
    initials: 'XY',
    roles,
  },
});

const ALL_CAPS: Capability[] = Object.keys(CAPABILITY_ROLES) as Capability[];

describe('Super Admin — has every capability', () => {
  const s = mkSession(['super_admin']);
  for (const cap of ALL_CAPS) {
    it(`has ${cap}`, () => {
      expect(hasCapability(s, cap)).toBe(true);
    });
  }
});

describe('Staff — effectively no approval or admin capabilities', () => {
  const s = mkSession(['staff']);
  const blocked: Capability[] = [
    'invoice.approve.over_20k',
    'invoice.approve.under_20k',
    'invoice.send',
    'expense.approve.over_2k',
    'expense.approve.under_2k',
    'bill.approve',
    'payrun.approve',
    'person.create',
    'ratecard.edit',
    'integration.manage',
    'auditlog.view',
    'approval.policy.edit',
  ];

  for (const cap of blocked) {
    it(`cannot ${cap}`, () => {
      expect(hasCapability(s, cap)).toBe(false);
    });
  }

  it('can submit their own timesheet', () => {
    expect(hasCapability(s, 'timesheet.submit')).toBe(true);
  });

  it('can submit expenses (for their own review later)', () => {
    expect(hasCapability(s, 'expense.submit')).toBe(true);
  });
});

describe('Manager — can approve expenses under $2k (own project enforced elsewhere)', () => {
  const s = mkSession(['manager']);

  it('can approve expenses under $2k at the role level', () => {
    expect(hasCapability(s, 'expense.approve.under_2k')).toBe(true);
  });

  it('cannot approve expenses over $2k', () => {
    expect(hasCapability(s, 'expense.approve.over_2k')).toBe(false);
  });

  it('cannot approve invoices over $20k', () => {
    expect(hasCapability(s, 'invoice.approve.over_20k')).toBe(false);
  });

  it('cannot edit rate card', () => {
    expect(hasCapability(s, 'ratecard.edit')).toBe(false);
  });
});

describe('Partner — approves under-threshold invoices, creates projects', () => {
  const s = mkSession(['partner']);

  it('can approve invoices under $20k', () => {
    expect(hasCapability(s, 'invoice.approve.under_20k')).toBe(true);
  });

  it('cannot approve invoices over $20k', () => {
    expect(hasCapability(s, 'invoice.approve.over_20k')).toBe(false);
  });

  it('can create projects', () => {
    expect(hasCapability(s, 'project.create')).toBe(true);
  });

  it('cannot create people (admin territory)', () => {
    expect(hasCapability(s, 'person.create')).toBe(false);
  });

  it('can view rate card but not edit it', () => {
    expect(hasCapability(s, 'ratecard.view')).toBe(true);
    expect(hasCapability(s, 'ratecard.edit')).toBe(false);
  });
});

describe('Multi-role — partner + admin union', () => {
  const s = mkSession(['partner', 'admin']);

  it('gains admin-only capabilities', () => {
    expect(hasCapability(s, 'person.create')).toBe(true);
    expect(hasCapability(s, 'agent.run_manual')).toBe(true);
  });

  it('still blocked on super_admin-only capabilities', () => {
    expect(hasCapability(s, 'payrun.approve')).toBe(false);
    expect(hasCapability(s, 'ratecard.edit')).toBe(false);
    expect(hasCapability(s, 'invoice.approve.over_20k')).toBe(false);
  });
});

describe('Null session', () => {
  it('has no capability', () => {
    expect(hasCapability(null, 'timesheet.submit')).toBe(false);
    expect(hasCapability(null, 'ratecard.view')).toBe(false);
  });
});

describe('requireCapability', () => {
  it('throws UnauthorizedError when session is null', () => {
    expect(() => requireCapability(null, 'project.create')).toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when role lacks capability', () => {
    expect(() => requireCapability(mkSession(['staff']), 'ratecard.edit')).toThrow(
      UnauthorizedError,
    );
  });

  it('does not throw when role has capability', () => {
    expect(() =>
      requireCapability(mkSession(['super_admin']), 'ratecard.edit'),
    ).not.toThrow();
  });
});
