import type { Db } from './db.js';

export type CheckinStatus = 'sent' | 'unreachable' | 'failed';

/** The six check-in buttons; the schema's CHECK constraint lists the same values. */
export const CHECKIN_ANSWERS = [
  'uploaded',
  'not_yet',
  'stuck_install',
  'stuck_import',
  'stuck_upload',
  'stuck_other',
] as const;

export type CheckinAnswer = (typeof CHECKIN_ANSWERS)[number];

export function countCodes(db: Db, eventId: number): { claimed: number; unclaimed: number } {
  return db
    .prepare(
      `SELECT COUNT(claimed_by) AS claimed,
         COUNT(CASE WHEN claimed_by IS NULL AND private_key IS NOT NULL THEN 1 END) AS unclaimed
       FROM codes WHERE event_id = ?`,
    )
    .get(eventId) as { claimed: number; unclaimed: number };
}

export function hasAddress(db: Db, eventId: number, address: string): boolean {
  return db.prepare('SELECT 1 FROM codes WHERE event_id = ? AND address = ?').get(eventId, address) !== undefined;
}

export function insertCodes(
  db: Db,
  eventId: number,
  codes: ReadonlyArray<{ privateKey: string; address: string }>,
): void {
  const insert = db.prepare('INSERT INTO codes (event_id, private_key, address) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const code of codes) insert.run(eventId, code.privateKey, code.address);
  })();
}

/** Assigns the unclaimed code with the lowest id. Call it inside a transaction. */
export function assignNextCode(
  db: Db,
  eventId: number,
  userId: number,
  now: number,
): { privateKey: string; address: string } | undefined {
  const next = db
    .prepare(
      `SELECT id, private_key AS privateKey, address FROM codes
       WHERE event_id = ? AND claimed_by IS NULL AND private_key IS NOT NULL ORDER BY id LIMIT 1`,
    )
    .get(eventId) as { id: number; privateKey: string; address: string } | undefined;
  if (!next) return undefined;
  db.prepare('UPDATE codes SET claimed_by = ?, claimed_at = ? WHERE id = ?').run(userId, now, next.id);
  return { privateKey: next.privateKey, address: next.address };
}

export interface ClaimedCode {
  id: number;
  privateKey: string | null;
  address: string;
  claimedBy: number;
  claimedAt: number;
  checkinStatus: CheckinStatus | null;
  checkinAnswer: CheckinAnswer | null;
}

const CLAIMED = `SELECT id, private_key AS privateKey, address, claimed_by AS claimedBy, claimed_at AS claimedAt,
  checkin_status AS checkinStatus, checkin_answer AS checkinAnswer FROM codes`;

export function findCodeByClaimer(db: Db, eventId: number, userId: number): ClaimedCode | undefined {
  return db.prepare(`${CLAIMED} WHERE event_id = ? AND claimed_by = ?`).get(eventId, userId) as
    | ClaimedCode
    | undefined;
}

export function countClaimsSince(db: Db, eventId: number, since: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM codes WHERE event_id = ? AND claimed_at >= ?').get(eventId, since) as {
    n: number;
  };
  return row.n;
}

export function recentClaims(
  db: Db,
  eventId: number,
  limit: number,
): Array<{ claimedBy: number; claimedAt: number; address: string }> {
  return db
    .prepare(
      `SELECT claimed_by AS claimedBy, claimed_at AS claimedAt, address FROM codes
       WHERE event_id = ? AND claimed_by IS NOT NULL ORDER BY claimed_at DESC, id DESC LIMIT ?`,
    )
    .all(eventId, limit) as Array<{ claimedBy: number; claimedAt: number; address: string }>;
}

/** Addresses of codes nobody claimed, whether or not their keys are wiped. */
export function unclaimedAddresses(db: Db, eventId: number): string[] {
  return (
    db.prepare('SELECT address FROM codes WHERE event_id = ? AND claimed_by IS NULL ORDER BY id').all(eventId) as Array<{
      address: string;
    }>
  ).map((row) => row.address);
}

export function claimedCodes(db: Db, eventId: number): ClaimedCode[] {
  return db
    .prepare(`${CLAIMED} WHERE event_id = ? AND claimed_by IS NOT NULL ORDER BY claimed_at, id`)
    .all(eventId) as ClaimedCode[];
}
