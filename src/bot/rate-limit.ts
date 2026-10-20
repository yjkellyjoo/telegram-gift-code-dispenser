import type { Clock } from '../clock.js';

export interface RateLimit {
  limit: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimit = { limit: 3, windowMs: 2000 };

/** Returns a check that allows `limit` updates per account within `windowMs`. */
export function createRateLimiter(clock: Clock, { limit, windowMs }: RateLimit): (userId: number) => boolean {
  const seen = new Map<number, number[]>();
  return (userId) => {
    const now = clock.now();
    const recent = (seen.get(userId) ?? []).filter((t) => t > now - windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(now);
    seen.set(userId, recent);
    return allowed;
  };
}
