import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from '@/server/roles';

/**
 * "Invoices to generate" engine. Focus: the client-project gate that
 * keeps internal FHP projects and expense buckets out of the invoice
 * suggestion queue (they have no paying client → never invoiced), plus
 * a sanity check that real client engagements still surface.
 */

// Mock the DB so listInvoiceSuggestions' single findMany is controllable.
const db = vi.hoisted(() => ({
  project: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import { listInvoiceSuggestions } from '@/server/invoice-suggestions';

function sessionWith(roles: string[]): Session {
  return {
    person: {
      id: 'p1',
      email: 'x@foundry.health',
      firstName: 'A',
      lastName: 'B',
      initials: 'AB',
      roles: roles as Session['person']['roles'],
      headshotUrl: null,
      band: 'Partner' as Session['person']['band'],
    },
    realRoles: roles as Session['realRoles'],
    isRealSuperAdmin: roles.includes('super_admin'),
    viewAsRoles: null,
  };
}

const DAY = 24 * 3600 * 1000;
/** A start date old enough to trip the 14-day initiation floor. */
const oldStart = () => new Date(Date.now() - 40 * DAY);

/** Build a project row shaped like the findMany select in the engine. */
function project(
  code: string,
  overrides: Partial<{
    id: string;
    name: string;
    startDate: Date | null;
    milestones: unknown[];
    invoices: unknown[];
  }> = {},
) {
  return {
    id: overrides.id ?? `id-${code}`,
    code,
    name: overrides.name ?? `Project ${code}`,
    stage: 'delivery',
    startDate: overrides.startDate ?? oldStart(),
    client: { id: 'c1', code: 'CLI', legalName: 'Client Co' },
    milestones: overrides.milestones ?? [],
    invoices: overrides.invoices ?? [],
  };
}

describe('listInvoiceSuggestions — client-project gate', () => {
  beforeEach(() => {
    db.project.findMany.mockReset();
  });

  it('excludes internal FHP projects from the initiation signal', async () => {
    db.project.findMany.mockResolvedValue([project('FHP004', { name: 'Project Assay' })]);
    const out = await listInvoiceSuggestions(sessionWith(['super_admin']));
    expect(out).toEqual([]);
  });

  it('excludes internal FHP projects even with a delivered milestone', async () => {
    db.project.findMany.mockResolvedValue([
      project('FHP004', {
        milestones: [
          {
            id: 'm1',
            label: 'Phase 1',
            dueDate: new Date(Date.now() - 5 * DAY),
            amount: 100_00,
            status: 'delivered',
            invoiceId: null,
          },
        ],
      }),
    ]);
    const out = await listInvoiceSuggestions(sessionWith(['super_admin']));
    expect(out).toEqual([]);
  });

  it('excludes expense buckets (FHB000/FHO000/FHX000)', async () => {
    db.project.findMany.mockResolvedValue([
      project('FHB000'),
      project('FHO000'),
      project('FHX000'),
    ]);
    const out = await listInvoiceSuggestions(sessionWith(['super_admin']));
    expect(out).toEqual([]);
  });

  it('still surfaces real client engagements', async () => {
    db.project.findMany.mockResolvedValue([
      project('GNC004', { name: 'Pricing Support' }),
      project('FHP004', { name: 'Project Assay' }),
    ]);
    const out = await listInvoiceSuggestions(sessionWith(['super_admin']));
    expect(out).toHaveLength(1);
    const [first] = out;
    expect(first?.project.code).toBe('GNC004');
    expect(first?.kind).toBe('project_initiation');
  });
});
