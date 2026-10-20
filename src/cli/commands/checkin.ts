import { GrammyError } from 'grammy';
import { parseArgs } from 'node:util';
import { CHECKIN_KEYBOARD, checkinText } from '../../core/checkin.js';
import { eventState } from '../../core/event-state.js';
import { claimedCodes, markCheckinSent, setCheckinStatus } from '../../store/codes.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError } from '../errors.js';
import { requireEvent } from './event.js';

/** Telegram allows about 30 messages per second; stay well under it. */
const SEND_GAP_MS = 50;

export async function checkinSend(env: CommandEnv): Promise<void> {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = requireEvent(env);
  const state = eventState(event, env.deps.clock.now());
  if (state !== 'closed' && state !== 'wiped') throw new CliError('send the check-in after the event has closed');

  const db = env.db();
  const counts = { sent: 0, unreachable: 0, failed: 0 };
  const pending = claimedCodes(db, event.id).filter((code) => code.checkinStatus === null);
  for (const code of pending) {
    const now = env.deps.clock.now();
    markCheckinSent(db, code.id, now);
    try {
      await env.api().sendMessage(code.claimedBy, checkinText(event.title, code.claimedAt, now), {
        reply_markup: CHECKIN_KEYBOARD,
      });
      counts.sent += 1;
    } catch (err) {
      const blocked = err instanceof GrammyError && err.error_code === 403;
      setCheckinStatus(db, code.id, blocked ? 'unreachable' : 'failed');
      counts[blocked ? 'unreachable' : 'failed'] += 1;
    }
    await env.deps.sleep(SEND_GAP_MS);
  }
  env.out(`sent ${counts.sent} · unreachable ${counts.unreachable} · failed ${counts.failed}`);
}
