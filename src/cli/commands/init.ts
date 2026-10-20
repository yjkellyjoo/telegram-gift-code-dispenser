import { parseArgs } from 'node:util';
import { createDatabase, databasePath } from '../../store/db.js';
import type { CommandEnv } from '../env.js';
import { cliArgs } from '../errors.js';

export function init(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  createDatabase(env.deps.dataDir).close();
  env.out(`created ${databasePath(env.deps.dataDir)}`);
}
