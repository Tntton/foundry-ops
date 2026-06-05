import { describe, it, expect } from 'vitest';
import type { Role } from '@prisma/client';
import { ALL_TOOLS, runAssistantTool, assistantToolSpecs } from '@/server/agents/assistant/tools';
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

describe('assistant tool registry', () => {
  it('exposes the expected tools with unique names', () => {
    const names = ALL_TOOLS.map((t) => t.spec.name);
    // Phase 2 read tools + Phase 3a prefill_timesheet.
    expect(names).toEqual([
      'list_my_approvals',
      'list_my_projects',
      'get_my_hours_this_week',
      'find_project',
      'find_person',
      'get_my_expenses_recent',
      'list_expense_categories',
      'get_active_rate_card_for_role',
      'prefill_timesheet',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool has a non-empty description + valid input_schema', () => {
    for (const t of ALL_TOOLS) {
      expect(t.spec.description).toBeTruthy();
      expect(t.spec.input_schema).toBeDefined();
      expect(t.spec.input_schema.type).toBe('object');
    }
  });

  it('assistantToolSpecs() returns the same count as ALL_TOOLS', () => {
    expect(assistantToolSpecs().length).toBe(ALL_TOOLS.length);
  });
});

describe('runAssistantTool — capability gating + unknown tools', () => {
  it('returns a structured error for an unknown tool name', async () => {
    const session = mkSession(['staff']);
    const out = await runAssistantTool({ session }, 'no_such_tool', {});
    expect(out).toMatchObject({ error: expect.stringContaining('unknown_tool') });
  });

  it('blocks get_active_rate_card_for_role for staff (lacks ratecard.view)', async () => {
    const session = mkSession(['staff']);
    const out = await runAssistantTool(
      { session },
      'get_active_rate_card_for_role',
      { roleCode: 'E1' },
    );
    expect(out).toMatchObject({
      error: expect.stringContaining('permission_denied'),
    });
  });

  it('staff who lack ratecard.view still get the public tools (no permission_denied)', async () => {
    // We can't run list_my_projects here without a DB, but we can
    // confirm the capability gate isn't blocking — the registered
    // tool has no capability field, so calling it returns whatever
    // the DB layer returns. We assert the response, if it's an
    // error, isn't a permission_denied prefix.
    const session = mkSession(['staff']);
    const out = await runAssistantTool({ session }, 'list_expense_categories', {});
    // This tool has no DB dependency — should return real data.
    expect(out).toHaveProperty('rows');
    expect(Array.isArray((out as { rows: unknown }).rows)).toBe(true);
  });
});

describe('list_expense_categories — pure tool (no DB)', () => {
  it('returns the canonical category set, each row { value, label }', async () => {
    const session = mkSession(['staff']);
    const out = (await runAssistantTool({ session }, 'list_expense_categories', {})) as {
      rows: Array<{ value: string; label: string }>;
    };
    expect(out.rows.length).toBeGreaterThan(10);
    for (const row of out.rows) {
      expect(typeof row.value).toBe('string');
      expect(typeof row.label).toBe('string');
      // Categories are snake_case.
      expect(row.value).toMatch(/^[a-z_]+$/u);
    }
    // Spot-check well-known categories.
    const values = out.rows.map((r) => r.value);
    expect(values).toContain('travel');
    expect(values).toContain('meals_entertainment');
    expect(values).toContain('software_subscriptions');
  });
});

describe('find_project + find_person — input validation', () => {
  it('find_project rejects missing query', async () => {
    const session = mkSession(['staff']);
    const out = await runAssistantTool({ session }, 'find_project', {});
    expect(out).toMatchObject({ error: expect.stringContaining('query') });
  });

  it('find_person rejects empty query', async () => {
    const session = mkSession(['staff']);
    const out = await runAssistantTool({ session }, 'find_person', { query: '' });
    expect(out).toMatchObject({ error: expect.stringContaining('query') });
  });
});

describe('get_active_rate_card_for_role — input + capability composition', () => {
  it('blocks staff first (cap before validation)', async () => {
    const session = mkSession(['staff']);
    const out = await runAssistantTool(
      { session },
      'get_active_rate_card_for_role',
      // Intentionally malformed — the capability gate must fire first.
      {},
    );
    expect(out).toMatchObject({
      error: expect.stringContaining('permission_denied'),
    });
  });
});
