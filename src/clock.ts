/** Milliseconds since the Unix epoch (UTC). Injected so tests control time. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
