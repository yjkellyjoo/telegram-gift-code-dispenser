import type { Api } from 'grammy';
import { verifyPassphrase } from '../core/passphrase.js';
import { recordFailure } from '../store/attempts.js';
import { assignNextCode } from '../store/codes.js';
import { getEvent, type EventRow } from '../store/events.js';
import { plain, type Flow, type Reply } from './flow.js';
import { msg, renderDelivery } from './messages.js';

function codeReply(event: EventRow, code: { privateKey: string; address: string }): Reply {
  return { text: renderDelivery(event.title, event.instructions, code), html: true };
}

export function startReply(flow: Flow): string {
  const event = getEvent(flow.db);
  return event ? msg.start(event.title) : msg.noEventOpen;
}

export interface TextOutcome {
  reply: Reply;
  /** Set when this claim tripped the breaker, so the admin gets told. */
  trippedEvent?: EventRow;
}

/** Any non-command text: the claim flow of spec §8.2. Later tasks add the remaining rows. */
export async function textReply(_api: Api, flow: Flow, userId: number, text: string): Promise<TextOutcome> {
  const { db, clock, log } = flow;
  const event = getEvent(db);
  if (!event) return { reply: plain(msg.noEventOpen) };

  const right = event.passphraseHash !== null && (await verifyPassphrase(text, event.passphraseHash));
  if (!right) {
    const failures = recordFailure(db, event.id, userId);
    log.info('wrong passphrase', { user: userId, failures });
    return { reply: plain(msg.wrong(event.maxAttempts - failures)) };
  }
  const code = db.transaction(() => assignNextCode(db, event.id, userId, clock.now()))();
  if (!code) return { reply: plain(msg.allClaimed) };
  log.info('claimed', { user: userId, address: code.address });
  return { reply: codeReply(event, code) };
}
