// Reads every unclaimed key at once. Only src/cli may import this module; eslint.config.js enforces it,
// so the bot process contains no code path that returns more than the caller's own code.
import type { Db } from './db.js';

export function unclaimedKeys(db: Db, eventId: number): Array<{ privateKey: string; address: string }> {
  return db
    .prepare(
      `SELECT private_key AS privateKey, address FROM codes
       WHERE event_id = ? AND claimed_by IS NULL AND private_key IS NOT NULL ORDER BY id`,
    )
    .all(eventId) as Array<{ privateKey: string; address: string }>;
}

/** Deletes every key, claimed or not, and the passphrase hash. Returns how many keys were deleted. */
export function wipeKeys(db: Db, eventId: number, now: number): number {
  return db.transaction((): number => {
    const { changes } = db
      .prepare('UPDATE codes SET private_key = NULL WHERE event_id = ? AND private_key IS NOT NULL')
      .run(eventId);
    db.prepare('UPDATE events SET passphrase_hash = NULL, wiped_at = COALESCE(wiped_at, ?) WHERE id = ?').run(
      now,
      eventId,
    );
    return changes;
  })();
}

/** Rewrites the file and empties the write-ahead log. Returns false when a reader kept the log busy. */
export function compactDatabase(db: Db): boolean {
  db.exec('VACUUM');
  const [result] = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
  return result?.busy === 0;
}
