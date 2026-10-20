import type { Clock } from '../clock.js';
import type { Logger } from '../log.js';
import type { Db } from '../store/db.js';

/** What every bot handler needs. */
export interface Flow {
  db: Db;
  clock: Clock;
  log: Logger;
  adminUserId: number;
  botId: number;
}

export interface Reply {
  text: string;
  html: boolean;
}

export const plain = (text: string): Reply => ({ text, html: false });
