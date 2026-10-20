import { GrammyError } from 'grammy';
import { parseArgs } from 'node:util';
import { ordinal } from '../../bot/messages.js';
import { eventState } from '../../core/event-state.js';
import { lockedOutAccounts } from '../../store/attempts.js';
import { countCodes, recentClaims } from '../../store/codes.js';
import { getEvent, type EventRow } from '../../store/events.js';
import { formatDateTime, formatTime } from '../../time.js';
import type { CommandEnv } from '../env.js';
import { cliArgs } from '../errors.js';
import { checkGroup } from '../group.js';

const label = (name: string): string => name.padEnd(10);
const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

function stateLine(event: EventRow, now: number): string {
  const state = eventState(event, now);
  switch (state) {
    case 'scheduled':
      return `SCHEDULED · opens ${formatDateTime(event.opensAt, event.tz)}`;
    case 'open':
      return `OPEN · closes ${formatDateTime(event.closesAt, event.tz)}`;
    case 'closed':
      return event.exportedAt === null ? 'CLOSED · next: dispenser export' : 'CLOSED · exported · next: dispenser wipe';
    case 'wiped':
      return 'WIPED';
  }
}

function breakerLine(event: EventRow): string {
  if (event.pausedAt === null) return 'clear';
  const since = `PAUSED since ${formatTime(event.pausedAt, event.tz)}`;
  if (event.pausedReason === 'manual') return `${since} · paused by hand`;
  return `${since} · claim burst: a ${ordinal(event.tripCount + 1)} claim within ${event.tripSeconds} s (limit ${event.tripCount} per ${event.tripSeconds} s)`;
}

async function groupLine(env: CommandEnv, event: EventRow): Promise<string> {
  try {
    const group = await checkGroup(env.api(), event.groupChatId);
    const verdict =
      group.botStatus === 'administrator'
        ? 'bot is an admin (checked live)'
        : `bot is NOT an admin (status ${group.botStatus}); claims fail closed`;
    return `${event.groupChatId} “${group.title}” · ${verdict}`;
  } catch (err) {
    const why = err instanceof GrammyError ? `${err.error_code}: ${err.description}` : 'no answer from Telegram';
    return `${event.groupChatId} · lookup failed (${why}); claims fail closed`;
  }
}

export async function status(env: CommandEnv): Promise<void> {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const db = env.db();
  const event = getEvent(db);
  if (!event) {
    env.out('No event yet. Create one with "dispenser event create".');
    return;
  }
  const now = env.deps.clock.now();
  const { claimed, unclaimed } = countCodes(db, event.id);
  const recent = recentClaims(db, event.id, 10);
  const lastClaim = recent[0] ? ` · last claim ${formatTime(recent[0].claimedAt, event.tz)}` : '';
  const locked = lockedOutAccounts(db, event.id, event.maxAttempts);

  env.out(`${label('Event')}${event.title} · ${stateLine(event, now)}`);
  env.out(`${label('Claims')}${claimed} claimed · ${unclaimed} left${lastClaim}`);
  env.out(`${label('Breaker')}${breakerLine(event)}`);
  env.out(`${label('Group')}${await groupLine(env, event)}`);
  env.out(`${label('Lockouts')}${locked.length}${locked.length > 0 ? ` · ${locked.join(', ')}` : ''}`);
  recent.forEach((claim, i) => {
    env.out(`${label(i === 0 ? 'Recent' : '')}${formatTime(claim.claimedAt, event.tz)}  ${claim.claimedBy}  ${short(claim.address)}`);
  });
}
