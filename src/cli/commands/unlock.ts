import { parseArgs } from 'node:util';
import { resetFailures } from '../../store/attempts.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError, intArg } from '../errors.js';
import { requireEvent } from './event.js';

export function unlock(env: CommandEnv): void {
  const { positionals } = cliArgs(() =>
    parseArgs({ args: env.argv, options: {}, allowPositionals: true, strict: true }),
  );
  if (positionals.length !== 1 || positionals[0] === undefined) throw new CliError('usage: dispenser unlock <telegram user id>');
  const userId = intArg(positionals[0], 'the Telegram user ID', 1, Number.MAX_SAFE_INTEGER);
  const event = requireEvent(env);
  if (!resetFailures(env.db(), event.id, userId)) throw new CliError(`no wrong tries recorded for ${userId}`);
  env.out(`unlocked ${userId}; they can try the passphrase again`);
}
