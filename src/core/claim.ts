import { assignNextCode, findCodeByClaimer } from '../store/codes.js';
import type { Db } from '../store/db.js';
import { getEvent } from '../store/events.js';

export type ClaimResult =
  | { kind: 'code'; privateKey: string; address: string; isNew: boolean }
  | { kind: 'wiped' }
  | { kind: 'pool_empty' };

/**
 * The only function in the bot process that returns a key: the caller's own, at most one.
 * One IMMEDIATE transaction, so concurrent claims from one account all get the same code.
 */
export function claimOrGet(db: Db, now: number, userId: number): ClaimResult {
  return db
    .transaction((): ClaimResult => {
      const event = getEvent(db);
      if (!event) return { kind: 'pool_empty' };
      const existing = findCodeByClaimer(db, event.id, userId);
      if (existing) {
        return existing.privateKey === null
          ? { kind: 'wiped' }
          : { kind: 'code', privateKey: existing.privateKey, address: existing.address, isNew: false };
      }
      const code = assignNextCode(db, event.id, userId, now);
      return code ? { kind: 'code', ...code, isNew: true } : { kind: 'pool_empty' };
    })
    .immediate();
}
