import type { Api } from 'grammy';
import { claimOrGet } from '../core/claim.js';
import { classifyMember, type Membership } from '../core/membership.js';
import { verifyPassphrase } from '../core/passphrase.js';
import { errorFields } from '../log.js';
import { failuresOf, releaseTry, reserveTry, settleWrong } from '../store/attempts.js';
import { countCodes, findCodeByClaimer } from '../store/codes.js';
import { getEvent, type EventRow } from '../store/events.js';
import { plain, type Flow, type Reply } from './flow.js';
import { msg, renderDelivery } from './messages.js';

function codeReply(event: EventRow, code: { privateKey: string; address: string }): Reply {
  return { text: renderDelivery(event.title, event.instructions, code), html: true };
}

export function startReply(flow: Flow, userId: number): string {
  const event = getEvent(flow.db);
  if (!event) return msg.noEventOpen;
  const hasCode = findCodeByClaimer(flow.db, event.id, userId) !== undefined;
  return hasCode ? `${msg.start(event.title)}\n\n${msg.startHasCode}` : msg.start(event.title);
}

export function myCodeReply(flow: Flow, userId: number): Reply {
  const event = getEvent(flow.db);
  const code = event ? findCodeByClaimer(flow.db, event.id, userId) : undefined;
  if (!event || !code) return plain(msg.noCodeYet);
  if (code.privateKey === null) return plain(msg.noLongerStored);
  return codeReply(event, { privateKey: code.privateKey, address: code.address });
}

export interface TextOutcome {
  reply: Reply;
  /** Set when this claim tripped the breaker, so the admin gets told. */
  trippedEvent?: EventRow;
}

/** Any non-command text: the claim flow of spec §8.2, in row order. */
export async function textReply(api: Api, flow: Flow, userId: number, text: string): Promise<TextOutcome> {
  const { db, clock, log } = flow;
  const event = getEvent(db);
  if (!event) return { reply: plain(msg.noEventOpen) };

  const existing = findCodeByClaimer(db, event.id, userId);
  if (existing) {
    if (existing.privateKey === null) return { reply: plain(msg.noLongerStored) };
    return { reply: codeReply(event, { privateKey: existing.privateKey, address: existing.address }) };
  }

  let membership: Membership;
  try {
    membership = classifyMember(await api.getChatMember(event.groupChatId, userId));
  } catch (err) {
    log.warn('membership lookup failed', { user: userId, ...errorFields(err) });
    return { reply: plain(msg.lookupFailed) };
  }
  if (membership === 'not_member') return { reply: plain(msg.notMember(event.title)) };
  if (membership === 'restricted') return { reply: plain(msg.restricted) };

  if (failuresOf(db, event.id, userId) >= event.maxAttempts) return { reply: plain(msg.lockedOut(userId)) };
  if (countCodes(db, event.id).unclaimed === 0) return { reply: plain(msg.allClaimed) };
  if (!reserveTry(db, event.id, userId, event.maxAttempts)) return { reply: plain(msg.lockedOut(userId)) };

  const right = event.passphraseHash !== null && (await verifyPassphrase(text, event.passphraseHash));
  if (!right) {
    const failures = settleWrong(db, event.id, userId, event.maxAttempts, clock.now());
    log.info('wrong passphrase', { user: userId, failures });
    const left = event.maxAttempts - failures;
    return { reply: plain(left > 0 ? msg.wrong(left) : msg.lockedOut(userId)) };
  }
  releaseTry(db, event.id, userId);

  const result = claimOrGet(db, clock.now(), userId);
  switch (result.kind) {
    case 'code':
      if (result.isNew) log.info('claimed', { user: userId, address: result.address });
      return { reply: codeReply(event, result) };
    case 'wiped':
      return { reply: plain(msg.noLongerStored) };
    case 'pool_empty':
      return { reply: plain(msg.allClaimed) };
  }
}
