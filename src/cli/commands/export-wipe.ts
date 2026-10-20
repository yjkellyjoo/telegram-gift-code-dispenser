import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { eventState } from '../../core/event-state.js';
import { compactDatabase, unclaimedKeys, wipeKeys } from '../../store/bulk.js';
import { unclaimedAddresses } from '../../store/codes.js';
import { updateEvent } from '../../store/events.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError, required } from '../errors.js';
import { requireEvent } from './event.js';

/** First 16 hex characters of SHA-256 over the sorted unclaimed addresses, newline-joined. */
function checksum(addresses: readonly string[]): string {
  return createHash('sha256').update([...addresses].sort().join('\n')).digest('hex').slice(0, 16);
}

export function exportCodes(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = requireEvent(env);
  const state = eventState(event, env.deps.clock.now());
  if (state === 'wiped') throw new CliError('the keys are already wiped');
  if (state !== 'closed') throw new CliError('the event is still open; close it first with "dispenser event close"');
  const db = env.db();
  const keys = unclaimedKeys(db, event.id);
  for (const { privateKey } of keys) env.out(privateKey);
  env.err(`checksum: ${checksum(unclaimedAddresses(db, event.id))} (${keys.length} codes)`);
  updateEvent(db, event.id, { exportedAt: env.deps.clock.now() });
}

export function wipe(env: CommandEnv): void {
  const { values } = cliArgs(() =>
    parseArgs({ args: env.argv, options: { checksum: { type: 'string' } }, strict: true }),
  );
  const given = required(values.checksum, '--checksum');
  const event = requireEvent(env);
  if (event.exportedAt === null) throw new CliError('run "dispenser export" first, and keep its output');
  const db = env.db();
  if (given !== checksum(unclaimedAddresses(db, event.id))) {
    throw new CliError('the checksum does not match the last export; nothing was deleted');
  }
  const deleted = wipeKeys(db, event.id, env.deps.clock.now());
  const compacted = compactDatabase(db);
  env.out(`wiped ${deleted} keys; the claim log is kept`);
  if (!compacted) env.err('the database was busy, so it may not be fully compacted; run the same wipe again');
}
