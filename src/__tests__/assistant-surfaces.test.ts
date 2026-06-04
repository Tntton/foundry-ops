import { describe, it, expect } from 'vitest';
import type { Role } from '@prisma/client';
import {
  visibleSurfaces,
  buildSystemPrompt,
  SURFACES,
} from '@/server/agents/assistant/system-prompt';
import type { Session } from '@/server/roles';

const mkSession = (roles: Role[]): Session => ({
  person: {
    id: 'p1',
    email: 'x@foundry.health',
    firstName: 'Pat',
    lastName: 'Tester',
    initials: 'PT',
    roles,
    headshotUrl: null,
    band: 'Consultant',
  },
  isRealSuperAdmin: roles.includes('super_admin'),
  viewAsRoles: null,
});

describe('assistant — surface visibility filters by role', () => {
  it('staff sees timesheet + expenses + projects + directory but not admin/import or approvals', () => {
    const s = mkSession(['staff']);
    const paths = new Set(visibleSurfaces(s).map((x) => x.path));
    expect(paths.has('/timesheet')).toBe(true);
    expect(paths.has('/expenses/new')).toBe(true);
    expect(paths.has('/projects')).toBe(true);
    expect(paths.has('/directory')).toBe(true);
    expect(paths.has('/approvals')).toBe(false);
    expect(paths.has('/admin/import/personnel')).toBe(false);
    expect(paths.has('/admin/rate-card')).toBe(false);
    expect(paths.has('/admin/feedback')).toBe(false);
    expect(paths.has('/invoices/new')).toBe(false);
    expect(paths.has('/bills/intake')).toBe(false);
  });

  it('super_admin sees every surface', () => {
    const s = mkSession(['super_admin']);
    const paths = new Set(visibleSurfaces(s).map((x) => x.path));
    for (const surf of SURFACES) {
      expect(paths.has(surf.path)).toBe(true);
    }
  });

  it('manager sees approvals + projects (own) + can submit timesheets', () => {
    const s = mkSession(['manager']);
    const paths = new Set(visibleSurfaces(s).map((x) => x.path));
    expect(paths.has('/approvals')).toBe(true);
    expect(paths.has('/timesheet')).toBe(true);
    expect(paths.has('/expenses/new')).toBe(true);
    expect(paths.has('/projects')).toBe(true);
    // Manager isn't the AP/admin tier so bills intake stays gated.
    expect(paths.has('/bills/intake')).toBe(false);
    expect(paths.has('/projects/new')).toBe(false);
    expect(paths.has('/admin/rate-card')).toBe(false);
  });

  it('partner can view rate card + create projects + approve invoices', () => {
    const s = mkSession(['partner']);
    const paths = new Set(visibleSurfaces(s).map((x) => x.path));
    expect(paths.has('/admin/rate-card')).toBe(true);
    expect(paths.has('/projects/new')).toBe(true);
    expect(paths.has('/invoices/new')).toBe(true);
    // Bill creation is admin/AP territory.
    expect(paths.has('/bills/intake')).toBe(false);
    // Feedback triage is super-admin only.
    expect(paths.has('/admin/feedback')).toBe(false);
  });

  it('multi-role union — partner+admin sees the union of both', () => {
    const partner = new Set(visibleSurfaces(mkSession(['partner'])).map((x) => x.path));
    const admin = new Set(visibleSurfaces(mkSession(['admin'])).map((x) => x.path));
    const combined = new Set(visibleSurfaces(mkSession(['partner', 'admin'])).map((x) => x.path));
    for (const p of partner) expect(combined.has(p)).toBe(true);
    for (const a of admin) expect(combined.has(a)).toBe(true);
  });
});

describe('assistant — buildSystemPrompt', () => {
  it('embeds the user name and role list', () => {
    const s = mkSession(['partner']);
    const prompt = buildSystemPrompt(s);
    expect(prompt).toContain('Pat Tester');
    expect(prompt).toContain('partner');
    expect(prompt).toContain('initials PT');
  });

  it('omits surfaces the user cannot use', () => {
    const s = mkSession(['staff']);
    const prompt = buildSystemPrompt(s);
    // /timesheet is visible to staff, /admin/rate-card isn't.
    expect(prompt).toContain('/timesheet');
    expect(prompt).not.toContain('/admin/rate-card');
    expect(prompt).not.toContain('/admin/feedback');
  });

  it('caps response length in the rules', () => {
    const prompt = buildSystemPrompt(mkSession(['staff']));
    // Hard requirement from the spec.
    expect(prompt.toLowerCase()).toContain('2-3 sentences');
  });
});
