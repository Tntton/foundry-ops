import { describe, it, expect } from 'vitest';
import {
  applyForecast,
  parseAdjustments,
  type BaselineProject,
} from '@/server/reports/forecast';

/**
 * TASK-072a · forecast projection. Pure what-if over a baseline set:
 * include/exclude + contract-value overrides, and defensive parsing of a
 * persisted adjustments blob.
 */

const projects: BaselineProject[] = [
  { id: 'p1', code: 'IFM001', name: 'Galileo', stage: 'delivery', clientCode: 'IFM', contractValueCents: 10_000_000 },
  { id: 'p2', code: 'GNC004', name: 'Pricing', stage: 'kickoff', clientCode: 'GNC', contractValueCents: 4_000_000 },
  { id: 'p3', code: 'FHP001', name: 'Internal', stage: 'standing', clientCode: 'FHP', contractValueCents: 1_000_000 },
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
