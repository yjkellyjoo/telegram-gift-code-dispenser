import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS } from './schema.js';

export type Db = Database.Database;

export class DatabaseError extends Error {
  override name = 'DatabaseError';
}

export function databasePath(dataDir: string): string {
  return join(dataDir, 'dispenser.db');
}

function applyPragmas(db: Db): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('secure_delete = ON');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

/** Creates a new database. Refuses when one exists, so `init` can never reset a live event. */
export function createDatabase(dataDir: string): Db {
  const path = databasePath(dataDir);
  if (existsSync(path)) throw new DatabaseError(`a database already exists at ${path}`);
  const db = new Database(path);
  applyPragmas(db);
  db.transaction(() => {
    for (const sql of MIGRATIONS) db.exec(sql);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(MIGRATIONS.length));
  })();
  return db;
}

/** Opens the existing database. Refuses when it is missing, so a mis-mounted volume fails loudly. */
export function openDatabase(dataDir: string): Db {
  const path = databasePath(dataDir);
  if (!existsSync(path)) throw new DatabaseError(`no database at ${path}; run "dispenser init" first`);
  const db = new Database(path, { fileMustExist: true });
  applyPragmas(db);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  if (row?.value !== String(MIGRATIONS.length)) {
    db.close();
    throw new DatabaseError(`unexpected schema version ${row?.value ?? 'none'}; this build expects ${MIGRATIONS.length}`);
  }
  return db;
}
