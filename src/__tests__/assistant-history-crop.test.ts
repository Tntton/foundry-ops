import { describe, it, expect } from 'vitest';
import {
  cropHistory,
  ASSISTANT_HISTORY_TURNS,
} from '@/server/agents/assistant/threads';

describe('cropHistory', () => {
  it('returns input unchanged when under the cap', () => {
    const small = Array.from({ length: 6 }, (_, i) => ({ i }));
    expect(cropHistory(small)).toEqual(small);
  });

  it('keeps only the trailing 2*N messages when over the cap', () => {
    const max = ASSISTANT_HISTORY_TURNS * 2;
    const big = Array.from({ length: max + 10 }, (_, i) => ({ i }));
    const out = cropHistory(big);
    expect(out.length).toBe(max);
    // First retained entry is index 10.
    expect(out[0]).toEqual({ i: 10 });
    expect(out[out.length - 1]).toEqual({ i: max + 9 });
  });

  it('returns a new array (does not mutate input)', () => {
    const a = [{ i: 0 }, { i: 1 }];
    const b = cropHistory(a);
    expect(b).not.toBe(a);
  });
});
