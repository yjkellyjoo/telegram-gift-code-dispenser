import type { Db } from './db.js';

export function failuresOf(db: Db, eventId: number, userId: number): number {
  const row = db
    .prepare('SELECT failures FROM attempts WHERE event_id = ? AND telegram_user_id = ?')
    .get(eventId, userId) as { failures: number } | undefined;
  return row?.failures ?? 0;
}

/**
 * Takes one try if the account has any left. The check and the increment share one
 * transaction, so concurrent guesses can never exceed `maxAttempts`.
 */
export function reserveTry(db: Db, eventId: number, userId: number, maxAttempts: number): boolean {
  return db
    .transaction((): boolean => {
      if (failuresOf(db, eventId, userId) >= maxAttempts) return false;
      db.prepare(
        `INSERT INTO attempts (event_id, telegram_user_id, failures) VALUES (?, ?, 1)
         ON CONFLICT (event_id, telegram_user_id) DO UPDATE SET failures = failures + 1`,
      ).run(eventId, userId);
      return true;
    })
    .immediate();
}

/** Gives back a try that was reserved for a passphrase that turned out right. */
export function releaseTry(db: Db, eventId: number, userId: number): void {
  db.prepare(
    'UPDATE attempts SET failures = failures - 1 WHERE event_id = ? AND telegram_user_id = ? AND failures > 0',
  ).run(eventId, userId);
}

/** Settles a wrong passphrase: sets locked_at the first time failures reach the limit. Returns the failures. */
export function settleWrong(db: Db, eventId: number, userId: number, maxAttempts: number, now: number): number {
  db.prepare(
    `UPDATE attempts SET locked_at = ?
     WHERE event_id = ? AND telegram_user_id = ? AND failures >= ? AND locked_at IS NULL`,
  ).run(now, eventId, userId, maxAttempts);
  return failuresOf(db, eventId, userId);
}

/** Lets a locked-out account try again. locked_at stays, so stats still count the lockout. */
export function resetFailures(db: Db, eventId: number, userId: number): boolean {
  return (
    db.prepare('UPDATE attempts SET failures = 0 WHERE event_id = ? AND telegram_user_id = ?').run(eventId, userId)
      .changes > 0
  );
}
