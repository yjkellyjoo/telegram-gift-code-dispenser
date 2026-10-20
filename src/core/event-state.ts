import type { EventRow } from '../store/events.js';

export type EventState = 'scheduled' | 'open' | 'closed' | 'wiped';

/** Derived from timestamps on every read; never stored. */
export function eventState(event: EventRow, now: number): EventState {
  if (event.wipedAt !== null) return 'wiped';
  if (event.closedAt !== null || now >= event.closesAt) return 'closed';
  if (now < event.opensAt) return 'scheduled';
  return 'open';
}
