import { inKpiWindow, parseCheckinData } from '../core/checkin.js';
import { findCodeByClaimer, recordCheckinAnswer } from '../store/codes.js';
import { getEvent } from '../store/events.js';
import type { Flow } from './flow.js';

/** Returns the pop-up text for a valid tap, or null to answer with nothing. */
export function checkinTap(flow: Flow, userId: number, data: string): string | null {
  const answer = parseCheckinData(data);
  if (answer === null) return null;
  const event = getEvent(flow.db);
  const code = event ? findCodeByClaimer(flow.db, event.id, userId) : undefined;
  if (!code || code.checkinStatus === null) return null;
  const now = flow.clock.now();
  if (!inKpiWindow(code.claimedAt, now)) return 'This check-in has closed.';
  recordCheckinAnswer(flow.db, code.id, answer, now);
  return 'Thanks! You can tap again to change your answer.';
}
