import { parseArgs } from 'node:util';
import { BlockscoutError, createBlockscout } from '../../chain/blockscout.js';
import { milestones } from '../../chain/milestones.js';
import { KPI_WINDOW_MS } from '../../core/checkin.js';
import { attemptTotals } from '../../store/attempts.js';
import { claimedCodes, type CheckinAnswer } from '../../store/codes.js';
import { formatDate } from '../../time.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError } from '../errors.js';
import { requireEvent } from './event.js';

const percent = (part: number, whole: number): string => `${whole === 0 ? 0 : Math.round((100 * part) / whole)}%`;

export async function stats(env: CommandEnv): Promise<void> {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = requireEvent(env);
  const db = env.db();
  const claims = claimedCodes(db, event.id);
  const { tried, everLockedOut } = attemptTotals(db, event.id);

  const chain = createBlockscout({ baseUrl: env.deps.blockscoutUrl, fetch: env.deps.fetch, sleep: env.deps.sleep });
  let redeemed = 0;
  let boughtStorage = 0;
  for (const claim of claims) {
    let txs;
    try {
      txs = await chain.outgoingTransactions(claim.address, claim.claimedAt);
    } catch (err) {
      if (err instanceof BlockscoutError) throw new CliError(`${err.message}; try again later`);
      throw err;
    }
    const result = milestones(txs, claim.claimedAt);
    if (result.redeemed) redeemed += 1;
    if (result.boughtStorage) boughtStorage += 1;
  }

  const count = (answer: CheckinAnswer) => claims.filter((c) => c.checkinAnswer === answer).length;
  const sent = claims.filter((c) => c.checkinStatus !== null).length;
  const unreachable = claims.filter((c) => c.checkinStatus === 'unreachable').length;
  const failed = claims.filter((c) => c.checkinStatus === 'failed').length;
  const answered = claims.filter((c) => c.checkinAnswer !== null).length;
  const stuck = count('stuck_install') + count('stuck_import') + count('stuck_upload') + count('stuck_other');

  const lastClaimAt = claims.at(-1)?.claimedAt;
  const finalAt = lastClaimAt === undefined ? undefined : lastClaimAt + KPI_WINDOW_MS;
  const window =
    finalAt === undefined || env.deps.clock.now() >= finalAt
      ? 'window: 30 days (final)'
      : `window: 30 days (in progress, final on ${formatDate(finalAt, event.tz)})`;
  const n = claims.length;

  env.out(`${event.title.padEnd(46)}${window}`);
  env.out('─'.repeat(70));
  env.out(`Bot       tried passphrase ${tried} · claimed ${n} · locked out ${everLockedOut}`);
  env.out(`Chain     redeemed ${redeemed} (${percent(redeemed, n)}) · bought storage ${boughtStorage} (${percent(boughtStorage, n)})`);
  env.out(`Check-in  sent ${sent} · unreachable ${unreachable} · failed ${failed} · answered ${answered}`);
  env.out(
    `          uploaded ${count('uploaded')} · not yet ${count('not_yet')} · stuck ${stuck} ` +
      `(installing ${count('stuck_install')} · key ${count('stuck_import')} · uploading ${count('stuck_upload')} · other ${count('stuck_other')})`,
  );
}
