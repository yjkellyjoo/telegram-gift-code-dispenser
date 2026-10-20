import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ADMIN_ID, Harness, PASSPHRASE } from '../test/harness.js';
import { key } from '../test/keys.js';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent({ keys: Array.from({ length: 10 }, (_, i) => key(i + 1)) });
});
afterEach(() => h.close());

const account = (n: number) => 5000 + n;

describe('the claim-burst breaker', () => {
  test('5 claims within 60 s succeed; the 6th trips it, is refused, and the admin is told once', async () => {
    for (let n = 1; n <= 6; n += 1) await h.say(account(n), PASSPHRASE);
    for (let n = 1; n <= 5; n += 1) expect(h.lastTextTo(account(n))).toMatch(/^Your gift code/);
    expect(h.lastTextTo(account(6))).toBe('Claims are paused. Please check back soon.');
    expect(h.telegram.textsTo(ADMIN_ID)).toEqual([
      [
        '🔴 Swarm booth: claims paused',
        'Claim burst: a 6th claim within 60 s (limit 5 per 60 s).',
        'Codes already claimed can still be re-sent.',
        'Check:  dispenser status',
        'Resume: dispenser resume',
      ].join('\n'),
    ]);
    await h.say(account(7), PASSPHRASE);
    expect(h.lastTextTo(account(7))).toBe('Claims are paused. Please check back soon.');
    expect(h.telegram.textsTo(ADMIN_ID)).toHaveLength(1);
  });

  test('re-sends keep working while paused', async () => {
    for (let n = 1; n <= 6; n += 1) await h.say(account(n), PASSPHRASE);
    await h.say(account(1), '/mycode');
    expect(h.lastTextTo(account(1))).toMatch(/^Your gift code/);
  });

  test('claims spread wider than the window never trip it', async () => {
    for (let n = 1; n <= 8; n += 1) {
      h.clock.advance(15_000);
      await h.say(account(n), PASSPHRASE);
    }
    expect(h.lastTextTo(account(8))).toMatch(/^Your gift code/);
  });

  test('resume restarts the window, so the 5 claims that tripped it cannot trip it again', async () => {
    for (let n = 1; n <= 6; n += 1) await h.say(account(n), PASSPHRASE);
    expect((await h.cli(['resume', '--yes'])).stdout).toBe('claims resumed; the burst window starts empty\n');
    await h.say(account(6), PASSPHRASE);
    expect(h.lastTextTo(account(6))).toMatch(/^Your gift code/);
  });

  test('--trip-rate sets the limit', async () => {
    h.close();
    h = new Harness();
    await h.openEvent({ extra: ['--trip-rate', '2/30'] });
    for (let n = 1; n <= 3; n += 1) await h.say(account(n), PASSPHRASE);
    expect(h.lastTextTo(account(3))).toBe('Claims are paused. Please check back soon.');
  });
});

describe('pause and resume by hand', () => {
  test('pause stops claims; resume asks for confirmation without --yes', async () => {
    expect((await h.cli(['pause'])).code).toBe(0);
    await h.say(account(1), PASSPHRASE);
    expect(h.lastTextTo(account(1))).toBe('Claims are paused. Please check back soon.');
    expect((await h.cli(['pause'])).stderr).toBe('error: claims are already paused\n');
    expect((await h.cli(['resume'])).stderr).toBe('error: confirm with --yes, or run it in a terminal\n');
    expect((await h.cli(['resume'], { tty: true, answers: ['n'] })).stderr).toBe('error: not resumed\n');
    expect((await h.cli(['resume'], { tty: true, answers: ['y'] })).code).toBe(0);
    await h.say(account(1), PASSPHRASE);
    expect(h.lastTextTo(account(1))).toMatch(/^Your gift code/);
    expect((await h.cli(['resume', '--yes'])).stderr).toBe('error: claims are not paused\n');
  });
});
