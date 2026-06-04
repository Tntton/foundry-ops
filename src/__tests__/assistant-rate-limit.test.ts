import { describe, it, expect, beforeEach } from 'vitest';
import {
  ASSISTANT_RATE_LIMIT,
  ASSISTANT_RATE_WINDOW_MS,
  checkAssistantRateLimit,
  _resetAssistantRateLimit,
} from '@/server/agents/assistant/rate-limit';

describe('assistant rate limit', () => {
  beforeEach(() => {
    _resetAssistantRateLimit();
  });

  it('passes when under the limit', () => {
    expect(checkAssistantRateLimit('p1', 1_000_000)).toBeNull();
    expect(checkAssistantRateLimit('p1', 1_000_001)).toBeNull();
  });

  it('rejects when the limit is reached, with a positive retryAfter', () => {
    let t = 1_000_000;
    for (let i = 0; i < ASSISTANT_RATE_LIMIT; i++) {
      const r = checkAssistantRateLimit('p1', t++);
      expect(r).toBeNull();
    }
    const r = checkAssistantRateLimit('p1', t);
    expect(r).not.toBeNull();
    expect(r!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('drops stamps that fall out of the 1-hour window', () => {
    const t0 = 1_000_000;
    // Fill the bucket.
    for (let i = 0; i < ASSISTANT_RATE_LIMIT; i++) {
      checkAssistantRateLimit('p1', t0 + i);
    }
    // Jump well past the window — bucket empties.
    const future = t0 + ASSISTANT_RATE_WINDOW_MS + 5_000;
    expect(checkAssistantRateLimit('p1', future)).toBeNull();
  });

  it('isolates per-person buckets', () => {
    let t = 1_000_000;
    for (let i = 0; i < ASSISTANT_RATE_LIMIT; i++) {
      checkAssistantRateLimit('p1', t++);
    }
    expect(checkAssistantRateLimit('p1', t)).not.toBeNull();
    // Different person, fresh bucket.
    expect(checkAssistantRateLimit('p2', t)).toBeNull();
  });
});
