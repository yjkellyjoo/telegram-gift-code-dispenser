import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { deliveryText, Harness, PASSPHRASE } from '../test/harness.js';
import { ADDRESS_1, ADDRESS_2, key } from '../test/keys.js';
import { textUpdate } from '../test/updates.js';

const ALICE = 5001;
const BOB = 5002;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

/** The keys inside delivery messages. */
const deliveredKeys = (texts: string[]): string[] =>
  texts.flatMap((t) => /<tg-spoiler><code>(0x[0-9a-f]{64})<\/code>/.exec(t)?.[1] ?? []);

describe('one code per account', () => {
  test('a second passphrase from the same account re-sends the same code', async () => {
    await h.say(ALICE, PASSPHRASE);
    await h.say(ALICE, PASSPHRASE);
    await h.say(BOB, PASSPHRASE);
    expect(h.telegram.textsTo(ALICE)).toEqual([deliveryText(key(1), ADDRESS_1), deliveryText(key(1), ADDRESS_1)]);
    expect(h.lastTextTo(BOB)).toBe(deliveryText(key(2), ADDRESS_2));
  });

  test('50 concurrent passphrases from one account: every reply that carries a code carries the same one', async () => {
    // Up to max_attempts sends are checked at once; the rest are told to wait as "too many tries" (spec §8.5).
    const bot = h.bot({ rateLimit: { limit: 1000, windowMs: 2000 } });
    await Promise.all(Array.from({ length: 50 }, () => bot.handleUpdate(textUpdate(ALICE, PASSPHRASE))));
    expect(new Set(deliveredKeys(h.telegram.textsTo(ALICE)))).toEqual(new Set([key(1)]));
    expect(h.telegram.textsTo(ALICE)).not.toContain('Something went wrong. Please try again later.');
    await h.say(BOB, PASSPHRASE);
    expect(h.lastTextTo(BOB)).toBe(deliveryText(key(2), ADDRESS_2));
  });

  test('30 accounts against 20 codes: 20 distinct codes, then "all claimed"', async () => {
    h.close();
    h = new Harness();
    await h.openEvent({ keys: Array.from({ length: 20 }, (_, i) => key(i + 1)), extra: ['--trip-rate', '100/60'] });
    const bot = h.bot({ rateLimit: { limit: 1000, windowMs: 2000 } });
    const accounts = Array.from({ length: 30 }, (_, i) => 6000 + i);
    await Promise.all(accounts.map((id) => bot.handleUpdate(textUpdate(id, PASSPHRASE))));
    const replies = accounts.map((id) => h.lastTextTo(id) ?? '');
    expect(new Set(deliveredKeys(replies)).size).toBe(20);
    expect(replies.filter((r) => r === 'All codes have been claimed.')).toHaveLength(10);
  });

  test('a failed send keeps the claim, and the next message delivers the same code', async () => {
    h.telegram.failNext('sendMessage', new Error('network down'));
    await h.say(ALICE, PASSPHRASE);
    expect(h.telegram.textsTo(ALICE)).toEqual([]);
    await h.say(ALICE, 'did it work?');
    expect(h.lastTextTo(ALICE)).toBe(deliveryText(key(1), ADDRESS_1));
  });

  test('/mycode re-sends the code, and says so when there is none', async () => {
    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toBe("You don't have a code yet.");
    await h.say(ALICE, PASSPHRASE);
    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toBe(deliveryText(key(1), ADDRESS_1));
  });

  test('/start mentions /mycode once the account has a code', async () => {
    await h.say(ALICE, PASSPHRASE);
    await h.say(ALICE, '/start');
    expect(h.lastTextTo(ALICE)).toMatch(/\n\nYou already have a code\. Send \/mycode to see it again\.$/);
  });
});
