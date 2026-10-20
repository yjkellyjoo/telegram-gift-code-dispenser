import { Api } from 'grammy';
import { errorFields } from '../log.js';
import { DatabaseError, openDatabase, type Db } from '../store/db.js';
import { pause, resume } from './commands/breaker.js';
import { checkinSend } from './commands/checkin.js';
import { eventClose, eventCreate, eventEdit, eventPassphrase } from './commands/event.js';
import { exportCodes, wipe } from './commands/export-wipe.js';
import { importCodes } from './commands/import.js';
import { init } from './commands/init.js';
import { stats } from './commands/stats.js';
import { status } from './commands/status.js';
import { unlock } from './commands/unlock.js';
import type { CliDeps, Command, CommandEnv } from './env.js';
import { CliError } from './errors.js';

export type { CliDeps, Terminal } from './env.js';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const COMMANDS: Record<string, Command> = {
  init,
  status,
  stats,
  'event create': eventCreate,
  'event edit': eventEdit,
  'event passphrase': eventPassphrase,
  'event close': eventClose,
  pause,
  resume,
  import: importCodes,
  unlock,
  export: exportCodes,
  wipe,
  'checkin send': checkinSend,
};

const USAGE = `usage: dispenser <command>

  init                      create the database
  status                    event, claims, breaker, group, lockouts, recent claims
  event create --title <text> --group=<chat id> --opens "YYYY-MM-DD HH:mm"
               --closes "YYYY-MM-DD HH:mm" [--tz <zone>] --instructions <file>
               [--passphrase-generate] [--max-attempts <n>] [--trip-rate <n>/<seconds>]
  event edit <any create flag except the passphrase>
  event passphrase [--generate]
  event close
  import <file|-> [--yes]
  pause
  resume [--yes]
  unlock <telegram user id>
  export
  wipe --checksum <sum>
  checkin send
  stats`;

export async function runCli(argv: string[], stdin: () => Promise<string>, deps: CliDeps): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const twoWords = `${argv[0] ?? ''} ${argv[1] ?? ''}`;
  const [name, rest] = COMMANDS[twoWords] ? [twoWords, argv.slice(2)] : [argv[0] ?? '', argv.slice(1)];
  const command = COMMANDS[name];
  if (!command) return { code: 2, stdout: '', stderr: `${USAGE}\n` };

  let db: Db | undefined;
  let api: Api | undefined;
  const env: CommandEnv = {
    argv: rest,
    deps,
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    stdin,
    db: () => (db ??= openDatabase(deps.dataDir)),
    api: () => {
      if (!api) {
        api = new Api(deps.token, { timeoutSeconds: 15 });
        for (const transformer of deps.transformers ?? []) api.config.use(transformer);
      }
      return api;
    },
  };

  let code = 0;
  try {
    await command(env);
  } catch (err) {
    code = 1;
    if (err instanceof CliError || err instanceof DatabaseError) {
      stderr.push(`error: ${err.message}`);
    } else {
      deps.log.error('command failed', { command: name, ...errorFields(err) });
      stderr.push(`error: unexpected failure (${err instanceof Error ? err.name : typeof err}); see the log`);
    }
  } finally {
    db?.close();
  }
  const join = (lines: string[]) => (lines.length > 0 ? `${lines.join('\n')}\n` : '');
  return { code, stdout: join(stdout), stderr: join(stderr) };
}
