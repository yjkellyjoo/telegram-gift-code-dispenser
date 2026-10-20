import { parseArgs } from 'node:util';
import { updateEvent } from '../../store/events.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError } from '../errors.js';
import { requireEvent } from './event.js';

export function pause(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = requireEvent(env);
  if (event.wipedAt !== null) throw new CliError('the event is wiped');
  if (event.pausedAt !== null) throw new CliError('claims are already paused');
  updateEvent(env.db(), event.id, { pausedAt: env.deps.clock.now(), pausedReason: 'manual' });
  env.out('claims paused; re-sends of claimed codes keep working. Resume with: dispenser resume');
}

export async function resume(env: CommandEnv): Promise<void> {
  const { values } = cliArgs(() => parseArgs({ args: env.argv, options: { yes: { type: 'boolean' } }, strict: true }));
  const event = requireEvent(env);
  if (event.pausedAt === null) throw new CliError('claims are not paused');
  const reason = event.pausedReason === 'burst' ? 'a claim burst tripped the breaker' : 'paused by hand';
  if (values.yes !== true) {
    if (!env.deps.terminal.isTTY) throw new CliError('confirm with --yes, or run it in a terminal');
    const answer = await env.deps.terminal.ask(`Claims are paused (${reason}). Resume? [y/N] `, { hidden: false });
    if (answer.trim().toLowerCase() !== 'y') throw new CliError('not resumed');
  }
  updateEvent(env.db(), event.id, { pausedAt: null, pausedReason: null, resumedAt: env.deps.clock.now() });
  env.out('claims resumed; the burst window starts empty');
}
