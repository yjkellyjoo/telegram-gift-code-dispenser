import { GrammyError } from 'grammy';
import { parseArgs } from 'node:util';
import { CHECKIN_KEYBOARD, checkinText } from '../../core/checkin.js';
import { eventState } from '../../core/event-state.js';
import { errorFields } from '../../log.js';
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
  let stopped = false;
  const pending = claimedCodes(db, event.id).filter((code) => code.checkinStatus === null);
  for (const code of pending) {
    const now = env.deps.clock.now();
    if (!markCheckinSent(db, code.id, now)) continue;
    try {
      await env.api().sendMessage(code.claimedBy, checkinText(event.title, code.claimedAt, now), {
        reply_markup: CHECKIN_KEYBOARD,
      });
      counts.sent += 1;
    } catch (err) {
      env.deps.log.warn('check-in send failed', { codeId: code.id, ...errorFields(err) });
      const errorCode = err instanceof GrammyError ? err.error_code : undefined;
      if (errorCode === 403) {
        setCheckinStatus(db, code.id, 'unreachable');
        counts.unreachable += 1;
      } else {
        setCheckinStatus(db, code.id, 'failed');
        counts.failed += 1;
        // Only 403 and 400 are about this recipient; anything else (401, a long 429, 5xx, no network) would hit the rest too.
        stopped = errorCode !== 400;
      }
    }
    if (stopped) break;
    await env.deps.sleep(SEND_GAP_MS);
  }
  env.out(`sent ${counts.sent} · unreachable ${counts.unreachable} · failed ${counts.failed}`);
  if (stopped) {
    throw new CliError(
      'stopped after a send error that is not about one recipient (see the log); fix it, then run "dispenser checkin send" again to send the rest',
    );
  }
}
