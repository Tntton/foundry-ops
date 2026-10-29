import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_SECTIONS,
  DASHBOARD_SECTION_KEYS,
  defaultLayout,
  normalizeLayout,
  parseDashboardLayout,
  applyLayoutOp,
  resolveDashboardLayout,
  type DashboardLayout,
  type DashboardSectionKey,
} from '@/server/dashboard-sections';

const ALL = new Set<DashboardSectionKey>(DASHBOARD_SECTION_KEYS);

describe('registry', () => {
  it('has unique keys', () => {
    const seen = new Set<string>();
    for (const s of DASHBOARD_SECTIONS) {
      expect(seen.has(s.key)).toBe(false);
      seen.add(s.key);
    }
  });
});

describe('defaultLayout', () => {
  it('partitions every section across the two columns exactly once', () => {
    const l = defaultLayout();
    expect([...l.main, ...l.aside].sort()).toEqual([...DASHBOARD_SECTION_KEYS].sort());
    expect(l.collapsed).toEqual([]);
    expect(l.hidden).toEqual([]);
  });
  it('puts firm_overview / this_week / alerts in the aside', () => {
    expect(defaultLayout().aside).toEqual(['firm_overview', 'this_week', 'alerts']);
  });
});

describe('normalizeLayout', () => {
  it('drops unknown keys and dedupes across columns', () => {
    const l = normalizeLayout({
      main: ['top_stats', 'bogus', 'top_stats', 'alerts'],
      aside: ['alerts', 'firm_overview'],
    });
    // alerts appears in main first → main wins, aside copy dropped.
    expect(l.main.filter((k) => k === 'alerts')).toEqual(['alerts']);
    expect(l.aside.includes('alerts')).toBe(false);
    expect(l.main.includes('bogus' as DashboardSectionKey)).toBe(false);
  });
  it('appends missing sections at their default column', () => {
    const l = normalizeLayout({ main: ['team_week'], aside: [] });
    // Every known key still present exactly once.
    expect([...l.main, ...l.aside].sort()).toEqual([...DASHBOARD_SECTION_KEYS].sort());
    // team_week kept its explicit lead position in main.
    expect(l.main[0]).toBe('team_week');
    // aside-default sections still land in aside.
    expect(l.aside).toContain('firm_overview');
  });
  it('degrades a garbage blob to the default', () => {
    expect(normalizeLayout(42)).toEqual(defaultLayout());
    expect(normalizeLayout(null)).toEqual(defaultLayout());
  });
});

describe('parseDashboardLayout', () => {
  it('reads the dashboardLayout sub-key', () => {
    const blob = { defaultScreen: '/', dashboardLayout: { main: ['alerts'], aside: [] } };
    expect(parseDashboardLayout(blob).main[0]).toBe('alerts');
  });
  it('returns default for a missing key', () => {
    expect(parseDashboardLayout({})).toEqual(defaultLayout());
  });
});

describe('applyLayoutOp', () => {
  it('move_up swaps a section with its predecessor in the same column', () => {
    const l = applyLayoutOp(defaultLayout(), { op: 'move_up', key: 'this_week' });
    expect(l.aside).toEqual(['this_week', 'firm_overview', 'alerts']);
  });
  it('move_up at the top is a no-op', () => {
    const before = defaultLayout();
    const l = applyLayoutOp(before, { op: 'move_up', key: 'action_strip' });
    expect(l.main).toEqual(before.main);
  });
  it('move_down at the bottom is a no-op', () => {
    const before = defaultLayout();
    const l = applyLayoutOp(before, { op: 'move_down', key: 'alerts' });
    expect(l.aside).toEqual(before.aside);
  });
  it('move_column moves main → aside, appended at the end', () => {
    const l = applyLayoutOp(defaultLayout(), { op: 'move_column', key: 'top_stats' });
    expect(l.main.includes('top_stats')).toBe(false);
    expect(l.aside[l.aside.length - 1]).toBe('top_stats');
  });
  it('move_column moves aside → main', () => {
    const l = applyLayoutOp(defaultLayout(), { op: 'move_column', key: 'alerts' });
    expect(l.aside.includes('alerts')).toBe(false);
    expect(l.main[l.main.length - 1]).toBe('alerts');
  });
  it('collapse / expand toggle membership', () => {
    const c = applyLayoutOp(defaultLayout(), { op: 'collapse', key: 'team_week' });
    expect(c.collapsed).toContain('team_week');
    const e = applyLayoutOp(c, { op: 'expand', key: 'team_week' });
    expect(e.collapsed).not.toContain('team_week');
  });
  it('hide / show toggle membership without changing column order', () => {
    const h = applyLayoutOp(defaultLayout(), { op: 'hide', key: 'alerts' });
    expect(h.hidden).toContain('alerts');
    expect(h.aside).toContain('alerts'); // stays in place for restore
    const s = applyLayoutOp(h, { op: 'show', key: 'alerts' });
    expect(s.hidden).not.toContain('alerts');
  });
  it('reset returns the factory default', () => {
    const messy = applyLayoutOp(
      applyLayoutOp(defaultLayout(), { op: 'hide', key: 'alerts' }),
      { op: 'move_column', key: 'top_stats' },
    );
    expect(applyLayoutOp(messy, { op: 'reset' })).toEqual(defaultLayout());
  });
  it('does not mutate the input', () => {
    const before = defaultLayout();
    const snapshot = JSON.stringify(before);
    applyLayoutOp(before, { op: 'move_column', key: 'top_stats' });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('resolveDashboardLayout', () => {
  it('filters to available sections and pulls hidden into the tray', () => {
    const layout: DashboardLayout = applyLayoutOp(defaultLayout(), {
      op: 'hide',
      key: 'alerts',
    });
    const available = new Set<DashboardSectionKey>([
      'top_stats',
      'operational_qc',
      'alerts',
      'firm_overview',
    ]);
    const r = resolveDashboardLayout(layout, available);
    expect(r.main).toEqual(['top_stats', 'operational_qc']);
    expect(r.aside).toEqual(['firm_overview']); // alerts hidden, this_week unavailable
    expect(r.hidden).toEqual(['alerts']);
  });
  it('reports isCustomised true only when it differs from default', () => {
    expect(resolveDashboardLayout(defaultLayout(), ALL).isCustomised).toBe(false);
    const moved = applyLayoutOp(defaultLayout(), { op: 'move_up', key: 'this_week' });
    expect(resolveDashboardLayout(moved, ALL).isCustomised).toBe(true);
  });
  it('marks collapsed only for available sections', () => {
    const layout = applyLayoutOp(defaultLayout(), { op: 'collapse', key: 'team_week' });
    const r = resolveDashboardLayout(layout, new Set(['top_stats']));
    expect(r.collapsed.has('team_week')).toBe(false);
  });
});
