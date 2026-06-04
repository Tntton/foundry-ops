/**
 * Per-process rate limit for the in-app assistant. Single-region Vercel
 * deployment means one process serves a given user's turns; this is fine
 * for the MVP volumes. Switch to Vercel KV / Upstash when we go multi-
 * region or the volume warrants it.
 *
 * Limit: 100 messages / hour / user (spec).
 */

export const ASSISTANT_RATE_LIMIT = 100;
export const ASSISTANT_RATE_WINDOW_MS = 60 * 60 * 1000;

type Bucket = number[];
const buckets = new Map<string, Bucket>();

/**
 * Returns null when the user is under the limit (and records the hit).
 * Returns `{ retryAfterSeconds }` when the user has breached.
 *
 * `now` is injected for testability — production callers don't pass it.
 */
export function checkAssistantRateLimit(
  personId: string,
  now: number = Date.now(),
): { retryAfterSeconds: number } | null {
  const cutoff = now - ASSISTANT_RATE_WINDOW_MS;
  const existing = buckets.get(personId) ?? [];
  // Drop stamps that fell out of the window.
  const fresh = existing.filter((t) => t > cutoff);
  if (fresh.length >= ASSISTANT_RATE_LIMIT) {
    // Oldest in-window stamp determines how long until a slot frees.
    const oldest = fresh[0] ?? now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + ASSISTANT_RATE_WINDOW_MS - now) / 1000),
    );
    buckets.set(personId, fresh);
    return { retryAfterSeconds };
  }
  fresh.push(now);
  buckets.set(personId, fresh);
  return null;
}

/** Test-only — clears all buckets. Not exported via index. */
export function _resetAssistantRateLimit(): void {
  buckets.clear();
}
