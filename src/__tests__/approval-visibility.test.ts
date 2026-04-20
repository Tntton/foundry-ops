import { describe, it, expect } from 'vitest';
import type { Role } from '@prisma/client';
import { approvalRoleFilter, canActOnApproval } from '@/server/roles';

describe('canActOnApproval', () => {
  it('super_admin can act on any requiredRole', () => {
    const r: Role[] = ['super_admin'];
    expect(canActOnApproval(r, 'super_admin')).toBe(true);
    expect(canActOnApproval(r, 'admin')).toBe(true);
    expect(canActOnApproval(r, 'partner')).toBe(true);
    expect(canActOnApproval(r, 'manager')).toBe(true);
    expect(canActOnApproval(r, 'staff')).toBe(true);
  });

  it('super_admin + other role still acts as super_admin override', () => {
    const r: Role[] = ['super_admin', 'partner'];
    expect(canActOnApproval(r, 'admin')).toBe(true);
    expect(canActOnApproval(r, 'manager')).toBe(true);
  });

  it('non-super_admin roles only match their explicit role', () => {
    expect(canActOnApproval(['partner'], 'partner')).toBe(true);
    expect(canActOnApproval(['partner'], 'admin')).toBe(false);
    expect(canActOnApproval(['admin'], 'super_admin')).toBe(false);
    expect(canActOnApproval(['admin', 'manager'], 'admin')).toBe(true);
    expect(canActOnApproval(['admin', 'manager'], 'partner')).toBe(false);
  });

  it('empty roles cannot act', () => {
    expect(canActOnApproval([], 'admin')).toBe(false);
  });
});

describe('approvalRoleFilter', () => {
  it('returns empty filter for super_admin (sees all)', () => {
    expect(approvalRoleFilter(['super_admin'])).toEqual({});
    expect(approvalRoleFilter(['super_admin', 'partner'])).toEqual({});
  });

  it('returns an IN filter for non-super_admin viewers', () => {
    expect(approvalRoleFilter(['partner'])).toEqual({
      requiredRole: { in: ['partner'] },
    });
    expect(approvalRoleFilter(['admin', 'manager'])).toEqual({
      requiredRole: { in: ['admin', 'manager'] },
    });
  });
});
