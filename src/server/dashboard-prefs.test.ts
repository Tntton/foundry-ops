import { describe, it, expect } from 'vitest';
import type { LeaderPendingAction } from '@/server/leader-actions';
import {
  ACTION_GROUPS,
  KIND_TO_GROUP,
  parseActionGroupPrefs,
  isGroupSuppressed,
  applyGroupOp,
  groupActions,
  countVisibleActions,
  type DashboardActionPrefs,
} from '@/server/dashboard-prefs';

const NOW = new Date('2026-07-02T00:00:00.000Z');

function action(kind: LeaderPendingAction['kind']): LeaderPendingAction {
  return { kind, title: kind, detail: '', href: '#', tone: 'blue' };
}

// The full set of kinds, derived from the type via the group table, so a
// new kind that isn't grouped surfaces here.
const ALL_KINDS = ACTION_GROUPS.flatMap((g) => g.kinds);

describe('KIND_TO_GROUP', () => {
  it('maps every kind in the group table to its group', () => {
    for (const g of ACTION_GROUPS) {
      for (const k of g.kinds) expect(KIND_TO_GROUP[k]).toBe(g.key);
    }
  });

  it('assigns each kind to exactly one group (no dupes across groups)', () => {
    const seen = new Set<string>();
    for (const k of ALL_KINDS) {
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});

describe('isGroupSuppressed', () => {
  it('undefined state → not suppressed', () => {
    expect(isGroupSuppressed(undefined, NOW)).toBe(false);
  });
  it('hidden → suppressed', () => {
    expect(isGroupSuppressed({ mode: 'hidden' }, NOW)).toBe(true);
  });
  it('snoozed in the future → suppressed', () => {
    const until = new Date(NOW.getTime() + 5 * 86400_000).toISOString();
    expect(isGroupSuppressed({ mode: 'snoozed', until }, NOW)).toBe(true);
  });
  it('snoozed in the past → not suppressed (expired)', () => {
    const until = new Date(NOW.getTime() - 1000).toISOString();
    expect(isGroupSuppressed({ mode: 'snoozed', until }, NOW)).toBe(false);
  });
});

describe('applyGroupOp', () => {
  it('hide sets mode hidden', () => {
    const next = applyGroupOp({}, 'business_dev', { op: 'hide' }, NOW);
    expect(next.business_dev).toEqual({ mode: 'hidden' });
  });
  it('snooze sets an until N days out', () => {
    const next = applyGroupOp({}, 'delivery', { op: 'snooze', days: 7 }, NOW);
    expect(next.delivery?.mode).toBe('snoozed');
    const until = new Date(
      (next.delivery as { until: string }).until,
    ).getTime();
    expect(until).toBe(NOW.getTime() + 7 * 86400_000);
  });
  it('clear removes the group and leaves others intact', () => {
    const before: DashboardActionPrefs = {
      business_dev: { mode: 'hidden' },
      billing: { mode: 'hidden' },
    };
    const next = applyGroupOp(before, 'business_dev', { op: 'clear' }, NOW);
    expect(next.business_dev).toBeUndefined();
    expect(next.billing).toEqual({ mode: 'hidden' });
  });
  it('does not mutate the input', () => {
    const before: DashboardActionPrefs = {};
    applyGroupOp(before, 'billing', { op: 'hide' }, NOW);
    expect(before).toEqual({});
  });
});

describe('groupActions', () => {
  it('buckets actions into columns in ACTION_GROUPS order', () => {
    const actions = [
      action('deal_stale'),
      action('bill_approval_queue'),
      action('self_expense_draft'),
    ];
    const { visible } = groupActions(actions, {}, NOW);
    expect(visible.map((g) => g.key)).toEqual([
      'approvals',
      'business_dev',
      'personal',
    ]);
  });

  it('omits empty groups and moves suppressed ones to `suppressed`', () => {
    const actions = [action('deal_stale'), action('bill_approval_queue')];
    const prefs: DashboardActionPrefs = { business_dev: { mode: 'hidden' } };
    const { visible, suppressed } = groupActions(actions, prefs, NOW);
    expect(visible.map((g) => g.key)).toEqual(['approvals']);
    expect(suppressed.map((g) => g.key)).toEqual(['business_dev']);
  });

  it('reports snooze days left, null for a permanent hide', () => {
    const until = new Date(NOW.getTime() + 3 * 86400_000 + 1000).toISOString();
    const prefs: DashboardActionPrefs = {
      business_dev: { mode: 'snoozed', until },
      billing: { mode: 'hidden' },
    };
    const { suppressed } = groupActions(
      [action('deal_stale'), action('invoice_to_draft')],
      prefs,
      NOW,
    );
    const bd = suppressed.find((s) => s.key === 'business_dev');
    const billing = suppressed.find((s) => s.key === 'billing');
    expect(bd?.snoozeDaysLeft).toBe(4); // ceil(3d + 1s)
    expect(billing?.snoozeDaysLeft).toBeNull();
  });

  it('surfaces a suppressed group even when it currently has no actions', () => {
    const prefs: DashboardActionPrefs = { business_dev: { mode: 'hidden' } };
    const { visible, suppressed } = groupActions([], prefs, NOW);
    expect(visible).toEqual([]);
    expect(suppressed.map((s) => s.key)).toEqual(['business_dev']);
  });
});

describe('countVisibleActions', () => {
  it('excludes actions in suppressed groups', () => {
    const actions = [
      action('deal_stale'),
      action('bill_approval_queue'),
      action('expense_approval_queue'),
    ];
    const prefs: DashboardActionPrefs = { business_dev: { mode: 'hidden' } };
    expect(countVisibleActions(actions, prefs, NOW)).toBe(2);
  });
});

describe('parseActionGroupPrefs', () => {
  it('returns {} for non-objects / missing key', () => {
    expect(parseActionGroupPrefs(null)).toEqual({});
    expect(parseActionGroupPrefs(42)).toEqual({});
    expect(parseActionGroupPrefs({})).toEqual({});
  });
  it('reads a valid dashboardActionGroups blob', () => {
    const blob = {
      defaultScreen: '/',
      dashboardActionGroups: { business_dev: { mode: 'hidden' } },
    };
    expect(parseActionGroupPrefs(blob)).toEqual({
      business_dev: { mode: 'hidden' },
    });
  });
  it('drops malformed entries rather than throwing', () => {
    const blob = { dashboardActionGroups: { business_dev: { mode: 'nope' } } };
    expect(parseActionGroupPrefs(blob)).toEqual({});
  });
});
