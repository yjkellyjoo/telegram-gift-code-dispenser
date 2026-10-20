import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { key } from '../test/keys.js';

const ALICE = 5001;
const BOB = 5002;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

describe('the event window', () => {
  test('before --opens nobody can claim', async () => {
    h.clock.set('2026-11-14T09:59:00Z');
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe('No event is open right now.');
    await h.say(ALICE, '/start');
    expect(h.lastTextTo(ALICE)).toBe('No event is open right now.');
  });

  test('at --closes claims stop, but a claimed code is still re-sent', async () => {
    await h.say(ALICE, PASSPHRASE);
    h.clock.set('2026-11-14T18:00:00Z');
    await h.say(BOB, PASSPHRASE);
    expect(h.lastTextTo(BOB)).toBe('No event is open right now.');
    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for Swarm booth:/);
  });

  test('event close stops claims at once and reports the counts', async () => {
    await h.say(ALICE, PASSPHRASE);
    expect((await h.cli(['event', 'close'])).stdout).toBe('closed: 1 claimed, 2 unclaimed. Next: dispenser export\n');
    await h.say(BOB, PASSPHRASE);
    expect(h.lastTextTo(BOB)).toBe('No event is open right now.');
    expect((await h.cli(['event', 'close'])).stderr).toBe('error: the event is already closed\n');
  });

  test('the window follows the event time zone', async () => {
    h.close();
    h = new Harness();
    await h.ok(['init']);
    await h.createEvent(['--tz', 'Europe/Berlin']); // 10:00–18:00 Berlin = 09:00–17:00 UTC in November
    await h.importKeys([key(1)]);
    h.clock.set('2026-11-14T09:30:00Z');
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code/);
    h.clock.set('2026-11-14T17:00:00Z');
    await h.say(BOB, PASSPHRASE);
    expect(h.lastTextTo(BOB)).toBe('No event is open right now.');
  });
});

test('a summer event (CEST, UTC+2) opens at the right instant', async () => {
  h.close();
  h = new Harness();
  h.clock.set('2026-07-01T00:00:00Z');
  await h.ok(['init']);
  await h.createEvent(['--opens', '2026-07-14 10:00', '--closes', '2026-07-14 18:00', '--tz', 'Europe/Berlin']);
  await h.importKeys([key(1)]);
  h.clock.set('2026-07-14T07:59:58Z');
  await h.say(ALICE, PASSPHRASE); // 07:59:59 UTC = 09:59:59 CEST
  expect(h.lastTextTo(ALICE)).toBe('No event is open right now.');
  h.clock.set('2026-07-14T07:59:59Z');
  await h.say(ALICE, PASSPHRASE); // 08:00:00 UTC = 10:00:00 CEST
  expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code/);
});

describe('dispenser event edit', () => {
  test('changes the title and closing time while open', async () => {
    const result = await h.cli(['event', 'edit', '--title', 'Swarm booth day 2', '--closes', '2026-11-14 20:00']);
    expect(result.stdout).toBe('updated title, closesAt\n');
    h.clock.set('2026-11-14T19:00:00Z');
    await h.say(ALICE, '/start');
    expect(h.lastTextTo(ALICE)).toMatch(/^To get your gift code for Swarm booth day 2,/);
  });

  test('--opens can only change before opening', async () => {
    expect((await h.cli(['event', 'edit', '--opens', '2026-11-14 11:00'])).stderr).toBe(
      'error: --opens can only change before the event opens\n',
    );
  });

  test('a closed event cannot change, and nothing is imported after close', async () => {
    await h.ok(['event', 'close']);
    expect((await h.cli(['event', 'edit', '--closes', '2026-11-14 20:00'])).stderr).toBe(
      'error: the event has closed; a closed event cannot change\n',
    );
    expect((await h.cli(['import', '-', '--yes'], { stdin: key(9) })).stderr).toBe(
      'error: the event has closed; import refused\n',
    );
  });

  test('a rotated passphrase replaces the old one at once', async () => {
    h.randomInts = [0, 1, 2];
    const rotated = await h.cli(['event', 'passphrase', '--generate']);
    expect(rotated.stdout).toBe('passphrase replaced; the old one stops working now\npassphrase: acid acorn acre\n');
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 4 tries left.");
    await h.say(ALICE, 'acid acorn acre');
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for Swarm booth:/);
  });

  test('refuses an edit with no flags', async () => {
    expect((await h.cli(['event', 'edit'])).stderr).toBe('error: nothing to change; pass at least one flag\n');
  });
});
