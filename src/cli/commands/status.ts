import { parseArgs } from 'node:util';
import { getEvent } from '../../store/events.js';
import type { CommandEnv } from '../env.js';
import { cliArgs } from '../errors.js';

export function status(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = getEvent(env.db());
  if (!event) {
    env.out('No event yet. Create one with "dispenser event create".');
    return;
  }
  env.out(`Event     ${event.title}`);
}
