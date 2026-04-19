import { describe, it, expect } from 'vitest';
import { computeDelta } from '@/server/audit';

describe('computeDelta', () => {
  it('returns null when neither before nor after provided', () => {
    expect(computeDelta(null, null)).toBeNull();
    expect(computeDelta(undefined, undefined)).toBeNull();
  });

  it('wraps { created } when only after provided', () => {
    const after = { name: 'Alice', status: 'active' };
    expect(computeDelta(null, after)).toEqual({ created: after });
    expect(computeDelta(undefined, after)).toEqual({ created: after });
  });

  it('wraps { deleted } when only before provided', () => {
    const before = { name: 'Alice', status: 'active' };
    expect(computeDelta(before, null)).toEqual({ deleted: before });
    expect(computeDelta(before, undefined)).toEqual({ deleted: before });
  });

  it('returns null when before === after', () => {
    const same = { name: 'Alice', status: 'active' };
    expect(computeDelta(same, { ...same })).toBeNull();
  });

  it('returns { changes: [...] } for a single edit', () => {
    const result = computeDelta(
      { name: 'Alice', status: 'draft' },
      { name: 'Alice', status: 'approved' },
    );
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('changes');
    const changes = (result as { changes: Array<Record<string, unknown>> }).changes;
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'E',
      path: ['status'],
      lhs: 'draft',
      rhs: 'approved',
    });
  });

  it('detects added + removed keys', () => {
    const result = computeDelta(
      { name: 'Alice', phone: '+61 400 111 222' },
      { name: 'Alice', email: 'alice@foundry.health' },
    );
    const changes = (result as { changes: Array<Record<string, unknown>> }).changes;
    const kinds = changes.map((c) => c['kind']).sort();
    expect(kinds).toEqual(['D', 'N']); // Deleted, New
  });

  it('detects nested changes', () => {
    const result = computeDelta(
      { name: 'Alice', meta: { tier: 'T1', fte: 1.0 } },
      { name: 'Alice', meta: { tier: 'T2', fte: 1.0 } },
    );
    const changes = (result as { changes: Array<Record<string, unknown>> }).changes;
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'E',
      path: ['meta', 'tier'],
      lhs: 'T1',
      rhs: 'T2',
    });
  });

  it('serializes to plain JSON (no Symbol/Diff class internals leak)', () => {
    const result = computeDelta(
      { a: 1 },
      { a: 2 },
    );
    // Round-tripping through JSON should preserve everything
    const roundtripped = JSON.parse(JSON.stringify(result));
    expect(roundtripped).toEqual(result);
  });
});
