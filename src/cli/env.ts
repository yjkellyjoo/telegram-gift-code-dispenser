import type { Api, Transformer } from 'grammy';
import type { Clock } from '../clock.js';
import type { Logger } from '../log.js';
import type { Db } from '../store/db.js';

export interface Terminal {
  isTTY: boolean;
  ask(question: string, options: { hidden: boolean }): Promise<string>;
}

export interface CliDeps {
  dataDir: string;
  token: string;
  defaultTz: string;
  clock: Clock;
  log: Logger;
  terminal: Terminal;
  randomInt: (max: number) => number;
  transformers?: Transformer[];
  fetch: typeof fetch;
  blockscoutUrl: string;
  sleep: (ms: number) => Promise<void>;
}

export interface CommandEnv {
  /** Arguments after the command words. */
  argv: string[];
  deps: CliDeps;
  out(line: string): void;
  err(line: string): void;
  stdin(): Promise<string>;
  /** Opens the database on first use; runCli closes it. */
  db(): Db;
  api(): Api;
}

export type Command = (env: CommandEnv) => Promise<void> | void;
