import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { POSTAGE_STAMP } from '../chain/milestones.js';
import { BlockscoutFake } from '../test/blockscout-fake.js';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { ADDRESS_1, ADDRESS_2, ADDRESS_3 } from '../test/keys.js';

const ALICE = 5001;
const BOB = 5002;
const CAROL = 5003;
const XBZZ = '0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da';
const SOMEONE = '0x000000000000000000000000000000000000dEaD';

let h: Harness;
let chain: BlockscoutFake;
beforeEach(async () => {
  h = new Harness();
  chain = new BlockscoutFake(2);
  h.fetch = chain.fetch;
  await h.openEvent();
  await h.say(ALICE, PASSPHRASE); // key(1) at 10:00:01
  await h.say(BOB, PASSPHRASE); // key(2) at 10:00:02
  await h.say(CAROL, PASSPHRASE); // key(3) at 10:00:03
  await h.ok(['event', 'close']);
});
afterEach(() => h.close());

describe('dispenser stats', () => {
  test('reports the funnel as totals, counting only sent transactions within 30 days of each claim', async () => {
    chain.add(
      // Alice approves xBZZ, buys a postage batch, then sends something else: three outgoing, two pages.
      { from: ADDRESS_1, to: XBZZ, timestamp: '2026-11-15T09:00:00.000000Z', method: 'approve' },
      { from: ADDRESS_1, to: POSTAGE_STAMP, timestamp: '2026-11-15T09:00:05.000000Z', method: 'createBatch' },
      { from: ADDRESS_1, to: SOMEONE, timestamp: '2026-11-20T09:00:00.000000Z' },
      // Bob's createBatch reverted, then he moved funds out: redeemed, but bought no storage.
      { from: ADDRESS_2, to: POSTAGE_STAMP, timestamp: '2026-11-16T09:00:00.000000Z', status: 'error' },
      { from: ADDRESS_2, to: SOMEONE, timestamp: '2026-11-16T09:10:00.000000Z' },
      // Carol: one transaction before her claim, one after day 30. Neither counts.
      { from: ADDRESS_3, to: POSTAGE_STAMP, timestamp: '2026-11-14T09:00:00.000000Z' },
      { from: ADDRESS_3, to: POSTAGE_STAMP, timestamp: '2026-12-14T10:00:04.000000Z' },
      // Someone funding Alice: incoming, never returned for filter=from.
      { from: SOMEONE, to: ADDRESS_1, timestamp: '2026-11-15T08:00:00.000000Z' },
    );
    h.clock.set('2026-11-21T12:00:00Z');
    const result = await h.cli(['stats']);
    expect(result.stdout).toBe(
      [
        `${'Swarm booth'.padEnd(46)}window: 30 days (in progress, final on 2026-12-14)`,
        '─'.repeat(70),
        'Bot       tried passphrase 3 · claimed 3 · locked out 0',
        'Chain     redeemed 2 (67%) · bought storage 1 (33%)',
        'Check-in  sent 0 · unreachable 0 · failed 0 · answered 0',
        '          uploaded 0 · not yet 0 · stuck 0 (installing 0 · key 0 · uploading 0 · other 0)',
        '',
      ].join('\n'),
    );
    for (const secretish of [ADDRESS_1, ADDRESS_2, ADDRESS_3, String(ALICE)]) expect(result.stdout).not.toContain(secretish);
    expect(chain.requests.every((r) => r.includes('filter=from'))).toBe(true);
  });

  test('says final once 30 days have passed since the last claim', async () => {
    h.clock.set('2026-12-14T10:00:03Z');
    expect((await h.cli(['stats'])).stdout).toMatch(/window: 30 days \(final\)$/m);
  });

  test('waits and retries when rate limited', async () => {
    chain.add({ from: ADDRESS_1, to: POSTAGE_STAMP, timestamp: '2026-11-15T09:00:00.000000Z' });
    chain.failNext(429);
    expect((await h.cli(['stats'])).stdout).toMatch(/^Chain     redeemed 1 \(33%\) · bought storage 1 \(33%\)$/m);
    expect(h.sleeps).toContain(2000);
  });

  test('fails with a clear error when Blockscout is down, naming no address', async () => {
    chain.failNext(503);
    const result = await h.cli(['stats']);
    expect(result.stderr).toBe('error: Blockscout answered 503; try again later\n');
  });

  test('counts every account that tried, and every lockout even after unlock', async () => {
    h.close();
    h = new Harness();
    h.fetch = new BlockscoutFake().fetch;
    await h.openEvent();
    for (let i = 0; i < 5; i += 1) await h.say(4242, `guess ${i}`);
    await h.ok(['unlock', '4242']);
    await h.say(ALICE, PASSPHRASE);
    expect((await h.cli(['stats'])).stdout).toMatch(/^Bot       tried passphrase 2 · claimed 1 · locked out 1$/m);
  });
});
