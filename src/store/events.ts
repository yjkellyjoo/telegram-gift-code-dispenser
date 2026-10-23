import type { Db } from './db.js';

export type PausedReason = 'burst' | 'manual';

export interface EventRow {
  id: number;
  title: string;
  tz: string;
  opensAt: number;
  closesAt: number;
  closedAt: number | null;
  groupChatId: number;
  /** The group's name as Telegram gave it at `event create`, or at the last `event edit --group`. */
  groupTitle: string;
  passphraseHash: string | null;
  maxAttempts: number;
  instructions: string;
  tripCount: number;
  tripSeconds: number;
  pausedAt: number | null;
  pausedReason: PausedReason | null;
  resumedAt: number | null;
  exportedAt: number | null;
  wipedAt: number | null;
}

export type NewEvent = Pick<
  EventRow,
  | 'title'
  | 'tz'
  | 'opensAt'
  | 'closesAt'
  | 'groupChatId'
  | 'groupTitle'
  | 'maxAttempts'
  | 'instructions'
  | 'tripCount'
  | 'tripSeconds'
> & { passphraseHash: string };

export type EventPatch = Partial<Omit<EventRow, 'id'>>;

const COLUMN: Record<keyof EventPatch, string> = {
  title: 'title',
  tz: 'tz',
  opensAt: 'opens_at',
  closesAt: 'closes_at',
  closedAt: 'closed_at',
  groupChatId: 'group_chat_id',
  groupTitle: 'group_title',
  passphraseHash: 'passphrase_hash',
  maxAttempts: 'max_attempts',
  instructions: 'instructions',
  tripCount: 'trip_count',
  tripSeconds: 'trip_seconds',
  pausedAt: 'paused_at',
  pausedReason: 'paused_reason',
  resumedAt: 'resumed_at',
  exportedAt: 'exported_at',
  wipedAt: 'wiped_at',
};

const SELECT = `SELECT id, ${Object.entries(COLUMN)
  .map(([field, column]) => `${column} AS ${field}`)
  .join(', ')} FROM events`;

/** The database holds at most one event. */
export function getEvent(db: Db): EventRow | undefined {
  return db.prepare(`${SELECT} ORDER BY id LIMIT 1`).get() as EventRow | undefined;
}

export function insertEvent(db: Db, event: NewEvent): void {
  db.prepare(
    `INSERT INTO events (title, tz, opens_at, closes_at, group_chat_id, group_title, passphrase_hash,
       max_attempts, instructions, trip_count, trip_seconds)
     VALUES (@title, @tz, @opensAt, @closesAt, @groupChatId, @groupTitle, @passphraseHash,
       @maxAttempts, @instructions, @tripCount, @tripSeconds)`,
  ).run(event);
}

export function updateEvent(db: Db, id: number, patch: EventPatch): void {
  const fields = (Object.keys(patch) as Array<keyof EventPatch>).filter((f) => patch[f] !== undefined);
  if (fields.length === 0) return;
  const sets = fields.map((f) => `${COLUMN[f]} = @${f}`).join(', ');
  db.prepare(`UPDATE events SET ${sets} WHERE id = @id`).run({ ...patch, id });
}
