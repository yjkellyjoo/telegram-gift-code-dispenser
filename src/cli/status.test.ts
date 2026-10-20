import { HttpError } from 'grammy';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { telegramRetry } from '../telegram-retry.js';
import { BOT_ID, GROUP_ID, Harness, PASSPHRASE } from '../test/harness.js';
import { key } from '../test/keys.js';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent({ keys: Array.from({ length: 10 }, (_, i) => key(i + 1)) });
});
afterEach(() => h.close());

describe('dispenser status', () => {
  test('shows claims, the breaker, the group, lockouts and recent claims', async () => {
    for (let i = 0; i < 5; i += 1) await h.say(4242, `guess ${i}`); // 10:00:01–05
    for (let n = 1; n <= 6; n += 1) await h.say(5000 + n, PASSPHRASE); // 10:00:06–11; the 6th trips
    expect((await h.cli(['status'])).stdout).toBe(
      [
        'Event     Swarm booth · OPEN · closes 2026-11-14 18:00 UTC',
        'Claims    5 claimed · 5 left · last claim 10:00:10',
        'Breaker   PAUSED since 10:00:11 · claim burst: a 6th claim within 60 s (limit 5 per 60 s)',
        'Group     -1001234567890 “Swarm booth chat” · bot is an admin (checked live)',
        'Lockouts  1 · 4242',
        'Recent    10:00:10  5005  0xe1AB…b276',
        '          10:00:09  5004  0x1efF…A718',
        '          10:00:08  5003  0x6813…BA69',
        '          10:00:07  5002  0x2B5A…D6cF',
        '          10:00:06  5001  0x7E5F…5Bdf',
        '',
      ].join('\n'),
    );
  });

  test('says when the bot lost admin, or Telegram cannot be reached', async () => {
    h.telegram.setStatus(GROUP_ID, BOT_ID, 'member');
    expect((await h.cli(['status'])).stdout).toMatch(/^Group     .*bot is NOT an admin \(status member\); claims fail closed$/m);
    h.telegram.failNext('getMe', new Error('network down'));
    expect((await h.cli(['status'])).stdout).toMatch(
      /^Group     -1001234567890 · lookup failed \(no answer from Telegram\); claims fail closed$/m,
    );
  });

  test('does not hang when Telegram is unreachable: network errors are not retried', async () => {
    h.telegram.failNext('getMe', new HttpError('Network request for getMe failed!', new Error('network down')));
    expect((await h.cli(['status'], { transformers: [telegramRetry()] })).stdout).toMatch(
      /^Group     -1001234567890 · lookup failed \(no answer from Telegram\); claims fail closed$/m,
    );
  });

  test('names the reason when the group was upgraded to a supergroup, so the admin can switch IDs', async () => {
    h.telegram.failNext('getChat', { error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat' });
    expect((await h.cli(['status'])).stdout).toMatch(
      /^Group     -1001234567890 · lookup failed \(400: Bad Request: group chat was upgraded to a supergroup chat\); claims fail closed$/m,
    );
  });
});
