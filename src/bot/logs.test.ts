import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE, TOKEN } from '../test/harness.js';
import { key } from '../test/keys.js';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

describe('logs', () => {
  test('carry no key, passphrase, token or message text, on success and error paths', async () => {
    const leakyError = () => new Error(`request to https://api.telegram.org/bot${TOKEN}/x failed`);
    await h.say(5001, PASSPHRASE);
    for (let i = 0; i < 5; i += 1) await h.say(5002, `my secret guess ${i}`);
    h.telegram.failNext('getChatMember', leakyError());
    await h.say(5003, PASSPHRASE);
    h.telegram.failNext('sendMessage', leakyError());
    await h.say(5004, PASSPHRASE);
    h.telegram.failNext('getMe', leakyError());
    await h.cli(['status']);
    await h.ok(['event', 'close']);
    await h.ok(['export']);

    const all = h.logs.join('\n');
    expect(h.logs.map((line) => JSON.parse(line).msg)).toEqual(
      expect.arrayContaining(['claimed', 'wrong passphrase', 'membership lookup failed', 'update failed']),
    );
    for (const n of [1, 2, 3]) expect(all).not.toContain(key(n).slice(2));
    expect(all.toLowerCase()).not.toContain(PASSPHRASE.toLowerCase());
    expect(all).not.toContain('my secret guess');
    expect(all).not.toContain(TOKEN);
  });
});
