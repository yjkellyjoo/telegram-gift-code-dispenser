import type { Db } from './db.js';

export function failuresOf(db: Db, eventId: number, userId: number): number {
  const row = db
    .prepare('SELECT failures FROM attempts WHERE event_id = ? AND telegram_user_id = ?')
    .get(eventId, userId) as { failures: number } | undefined;
  return row?.failures ?? 0;
}

/** Counts one wrong passphrase. Returns the account's failures so far. */
export function recordFailure(db: Db, eventId: number, userId: number): number {
  db.prepare(
    `INSERT INTO attempts (event_id, telegram_user_id, failures) VALUES (?, ?, 1)
     ON CONFLICT (event_id, telegram_user_id) DO UPDATE SET failures = failures + 1`,
  ).run(eventId, userId);
  return failuresOf(db, eventId, userId);
}
