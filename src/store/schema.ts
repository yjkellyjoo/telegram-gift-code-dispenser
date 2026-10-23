/** Migrations, numbered by position: MIGRATIONS[0] is version 1. Never edit one that has shipped. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE events (
    id              INTEGER PRIMARY KEY,
    title           TEXT    NOT NULL,
    tz              TEXT    NOT NULL,
    opens_at        INTEGER NOT NULL,
    closes_at       INTEGER NOT NULL,
    closed_at       INTEGER,
    group_chat_id   INTEGER NOT NULL,
    passphrase_hash TEXT,
    max_attempts    INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
    instructions    TEXT    NOT NULL,
    trip_count      INTEGER NOT NULL DEFAULT 5 CHECK (trip_count >= 1),
    trip_seconds    INTEGER NOT NULL DEFAULT 60 CHECK (trip_seconds BETWEEN 10 AND 3600),
    paused_at       INTEGER,
    paused_reason   TEXT CHECK (paused_reason IN ('burst', 'manual')),
    resumed_at      INTEGER,
    exported_at     INTEGER,
    wiped_at        INTEGER,
    CHECK (opens_at < closes_at),
    CHECK (passphrase_hash IS NOT NULL OR wiped_at IS NOT NULL)
  );

  CREATE TABLE codes (
    id                  INTEGER PRIMARY KEY,
    event_id            INTEGER NOT NULL REFERENCES events (id),
    private_key         TEXT,
    address             TEXT    NOT NULL,
    claimed_by          INTEGER,
    claimed_at          INTEGER,
    checkin_status      TEXT CHECK (checkin_status IN ('sent', 'unreachable', 'failed')),
    checkin_sent_at     INTEGER,
    checkin_answer      TEXT CHECK (checkin_answer IN
                          ('uploaded', 'not_yet', 'stuck_install', 'stuck_import', 'stuck_upload', 'stuck_other')),
    checkin_answered_at INTEGER,
    UNIQUE (event_id, claimed_by),
    UNIQUE (event_id, address),
    CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))
  );

  CREATE TABLE attempts (
    event_id         INTEGER NOT NULL REFERENCES events (id),
    telegram_user_id INTEGER NOT NULL,
    failures         INTEGER NOT NULL DEFAULT 0,
    locked_at        INTEGER,
    PRIMARY KEY (event_id, telegram_user_id)
  );
  `,
  `
  ALTER TABLE events ADD COLUMN group_title TEXT NOT NULL DEFAULT '';
  `,
];
