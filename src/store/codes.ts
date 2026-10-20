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
