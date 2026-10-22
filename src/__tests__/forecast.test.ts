import { describe, it, expect } from 'vitest';
import {
  applyForecast,
  parseAdjustments,
  parseHypotheticals,
  hypotheticalContribution,
  type BaselineProject,
  type HypotheticalProject,
} from '@/server/reports/forecast';

/**
 * TASK-072a · forecast projection. Pure what-if over a baseline set:
 * include/exclude + contract-value overrides, and defensive parsing of a
 * persisted adjustments blob.
 */

const projects: BaselineProject[] = [
  { id: 'p1', code: 'IFM001', name: 'Galileo', stage: 'delivery', clientCode: 'IFM', contractValueCents: 10_000_000, revenueCents: 4_000_000, marginCents: 2_800_000 },
  { id: 'p2', code: 'GNC004', name: 'Pricing', stage: 'kickoff', clientCode: 'GNC', contractValueCents: 4_000_000, revenueCents: 1_000_000, marginCents: 600_000 },
  { id: 'p3', code: 'FHP001', name: 'Internal', stage: 'standing', clientCode: 'FHP', contractValueCents: 1_000_000, revenueCents: 0, marginCents: -200_000 },
];

describe('applyForecast', () => {
  it('mirrors the baseline when there are no adjustments', () => {
    const r = applyForecast(projects, []);
    expect(r.baselineContractCents).toBe(15_000_000);
    expect(r.scenarioContractCents).toBe(15_000_000);
    expect(r.deltaCents).toBe(0);
    expect(r.baselineCount).toBe(3);
    expect(r.scenarioCount).toBe(3);
  });

  it('excludes a toggled-off project from the scenario total', () => {
    const r = applyForecast(projects, [
      { projectId: 'p3', included: false, contractValueCents: 1_000_000 },
    ]);
    expect(r.scenarioContractCents).toBe(14_000_000);
    expect(r.deltaCents).toBe(-1_000_000);
    expect(r.scenarioCount).toBe(2);
    expect(r.rows.find((x) => x.projectId === 'p3')!.scenarioContractCents).toBe(0);
    // Dropping the loss-making internal project lifts scenario margin.
    expect(r.margin.baselineCents).toBe(3_200_000);
    expect(r.margin.scenarioCents).toBe(3_400_000);
    expect(r.margin.deltaCents).toBe(200_000);
  });

  it('projects revenue by include/exclude, not by contract override', () => {
    // Overriding p2's contract value must not move revenue/margin.
    const r = applyForecast(projects, [
      { projectId: 'p2', included: true, contractValueCents: 9_000_000 },
    ]);
    expect(r.scenarioContractCents).toBe(20_000_000); // 10 + 9(override) + 1
    expect(r.revenue.scenarioCents).toBe(r.revenue.baselineCents); // all still included
    // Now exclude p2 → revenue drops by p2's booked revenue only.
    const r2 = applyForecast(projects, [
      { projectId: 'p2', included: false, contractValueCents: 4_000_000 },
    ]);
    expect(r2.revenue.deltaCents).toBe(-1_000_000);
  });

  it('applies a contract-value override and flags it', () => {
    const r = applyForecast(projects, [
      { projectId: 'p2', included: true, contractValueCents: 6_000_000 },
    ]);
    expect(r.scenarioContractCents).toBe(17_000_000);
    expect(r.deltaCents).toBe(2_000_000);
    const row = r.rows.find((x) => x.projectId === 'p2')!;
    expect(row.overridden).toBe(true);
    expect(row.scenarioContractCents).toBe(6_000_000);
  });

  it('ignores adjustments for unknown project ids', () => {
    const r = applyForecast(projects, [
      { projectId: 'ghost', included: false, contractValueCents: 999 },
    ]);
    expect(r.scenarioContractCents).toBe(15_000_000);
  });
});

describe('hypothetical projects', () => {
  const hypo: HypotheticalProject = {
    id: 'h1',
    name: 'Acme diligence',
    contractValueCents: 5_000_000,
    marginPct: 40,
  };

  it('computes a hypothetical contribution (full contract as revenue, contract × margin%)', () => {
    expect(hypotheticalContribution(hypo)).toEqual({
      contractCents: 5_000_000,
      revenueCents: 5_000_000,
      marginCents: 2_000_000,
    });
  });

  it('adds hypotheticals to the scenario totals only (baseline unchanged)', () => {
    const r = applyForecast(projects, [], [hypo]);
    // Baselines are the real book; scenario adds the hypothetical.
    expect(r.baselineContractCents).toBe(15_000_000);
    expect(r.scenarioContractCents).toBe(20_000_000);
    expect(r.revenue.baselineCents).toBe(5_000_000); // real booked revenue only
    expect(r.revenue.scenarioCents).toBe(10_000_000); // + 5M hypothetical
    expect(r.margin.deltaCents).toBe(2_000_000);
    expect(r.hypotheticalCount).toBe(1);
    expect(r.scenarioCount).toBe(4); // 3 real + 1 hypothetical
  });

  it('handles a negative-margin hypothetical', () => {
    const r = applyForecast(projects, [], [
      { id: 'h2', name: 'Loss leader', contractValueCents: 1_000_000, marginPct: -20 },
    ]);
    expect(r.margin.deltaCents).toBe(-200_000);
  });
});

describe('parseAdjustments', () => {
  it('accepts a valid blob', () => {
    const raw = [{ projectId: 'p1', included: true, contractValueCents: 100 }];
    expect(parseAdjustments(raw)).toEqual(raw);
  });
  it('drops a malformed blob to empty', () => {
    expect(parseAdjustments('nope')).toEqual([]);
    expect(parseAdjustments([{ projectId: 'p1' }])).toEqual([]);
    expect(parseAdjustments(null)).toEqual([]);
  });
});

describe('parseHypotheticals', () => {
  it('accepts a valid blob and drops malformed', () => {
    const raw = [{ id: 'h1', name: 'X', contractValueCents: 100, marginPct: 30 }];
    expect(parseHypotheticals(raw)).toEqual(raw);
    expect(parseHypotheticals([{ id: 'h1' }])).toEqual([]);
    expect(parseHypotheticals('nope')).toEqual([]);
  });
});
