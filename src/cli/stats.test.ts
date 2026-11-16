import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GnosisRpcFake } from '../test/gnosis-rpc-fake.js';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { ADDRESS_1, ADDRESS_2, ADDRESS_3 } from '../test/keys.js';

const ALICE = 5001;
const BOB = 5002;
const CAROL = 5003;
const SOMEONE = '0x000000000000000000000000000000000000dEaD';

let h: Harness;
let chain: GnosisRpcFake;
beforeEach(async () => {
  h = new Harness();
  chain = new GnosisRpcFake(() => h.clock.now());
  h.fetch = chain.fetch;
  await h.openEvent();
  await h.say(ALICE, PASSPHRASE); // key(1) at 10:00:01
  await h.say(BOB, PASSPHRASE); // key(2) at 10:00:02
  await h.say(CAROL, PASSPHRASE); // key(3) at 10:00:03
  await h.ok(['event', 'close']);
});
afterEach(() => h.close());

describe('dispenser stats', () => {
  test('reports the funnel as totals, counting only transactions within 30 days of each claim', async () => {
    chain.add(
      // Alice approves xBZZ, buys a postage batch, then sends something else.
      { from: ADDRESS_1, timestamp: '2026-11-15T09:00:00Z' },
      { from: ADDRESS_1, timestamp: '2026-11-15T09:00:05Z', batchOwner: ADDRESS_1 },
      { from: ADDRESS_1, timestamp: '2026-11-20T09:00:00Z' },
      // Bob's createBatch reverted, then he moved funds out: redeemed, but bought no storage.
      { from: ADDRESS_2, timestamp: '2026-11-16T09:00:00Z', batchOwner: ADDRESS_2, status: 'error' },
      { from: ADDRESS_2, timestamp: '2026-11-16T09:10:00Z' },
      // Carol: a batch before her claim, one after day 30. Neither counts.
      { from: ADDRESS_3, timestamp: '2026-11-14T09:00:00Z', batchOwner: ADDRESS_3 },
      { from: ADDRESS_3, timestamp: '2026-12-14T10:00:04Z', batchOwner: ADDRESS_3 },
      // Someone else buying storage for themselves.
      { from: SOMEONE, timestamp: '2026-11-15T08:00:00Z', batchOwner: SOMEONE },
    );
    h.clock.set('2026-12-20T12:00:00Z');
    const result = await h.cli(['stats']);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      [
        `${'Swarm booth'.padEnd(46)}window: 30 days (final)`,
        '─'.repeat(70),
        'Bot       tried passphrase 3 · claimed 3 · locked out 0',
        'Chain     redeemed 2 (67%) · bought storage 1 (33%)',
        'Check-in  sent 0 · unreachable 0 · failed 0 · answered 0',
        '          uploaded 0 · not yet 0 · stuck 0 (installing 0 · key 0 · uploading 0 · other 0)',
        '',
      ].join('\n'),
    );
    for (const secretish of [ADDRESS_1, ADDRESS_2, ADDRESS_3, String(ALICE)]) expect(result.stdout).not.toContain(secretish);
  });

  test('counts up to now while the window is in progress', async () => {
    chain.add({ from: ADDRESS_1, timestamp: '2026-11-20T09:00:00Z', batchOwner: ADDRESS_1 });
    h.clock.set('2026-11-21T12:00:00Z');
    const result = await h.cli(['stats']);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/window: 30 days \(in progress, final on 2026-12-14\)$/m);
    expect(result.stdout).toMatch(/^Chain     redeemed 1 \(33%\) · bought storage 1 \(33%\)$/m);
  });

  test('says final once 30 days have passed since the last claim', async () => {
    h.clock.set('2026-12-14T10:00:03Z');
    expect((await h.cli(['stats'])).stdout).toMatch(/window: 30 days \(final\)$/m);
  });

  test('waits and retries when rate limited', async () => {
    chain.add({ from: ADDRESS_1, timestamp: '2026-11-15T09:00:00Z', batchOwner: ADDRESS_1 });
    h.clock.set('2026-11-21T12:00:00Z');
    chain.failNext(429);
    expect((await h.cli(['stats'])).stdout).toMatch(/^Chain     redeemed 1 \(33%\) · bought storage 1 \(33%\)$/m);
    expect(h.sleeps).toContain(2000);
  });

  test('fails with a clear error when the RPC endpoint is down', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    chain.failNext(503);
    const result = await h.cli(['stats']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('error: Gnosis RPC answered 503; try again later\n');
  });

  test('passes on an RPC error without naming any address', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    chain.rpcErrorNext(`missing trie node for ${ADDRESS_1.toLowerCase()}`);
    const result = await h.cli(['stats']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('error: Gnosis RPC error: missing trie node for 0x…\n');
  });

  test('counts every account that tried, and every lockout even after unlock', async () => {
    h.close();
    h = new Harness();
    h.fetch = new GnosisRpcFake(() => h.clock.now()).fetch;
    await h.openEvent();
    for (let i = 0; i < 5; i += 1) await h.say(4242, `guess ${i}`);
    await h.ok(['unlock', '4242']);
    await h.say(ALICE, PASSPHRASE);
    expect((await h.cli(['stats'])).stdout).toMatch(/^Bot       tried passphrase 2 · claimed 1 · locked out 1$/m);
  });
});
