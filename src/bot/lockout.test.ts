import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { key } from '../test/keys.js';
import { textUpdate } from '../test/updates.js';

const ALICE = 5001;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

const guessWrong = async (times: number) => {
  for (let i = 0; i < times; i += 1) await h.say(ALICE, `guess ${i}`);
};

describe('passphrase tries', () => {
  test('counts down, then locks on the 5th wrong try and shows the ID', async () => {
    await guessWrong(4);
    expect(h.telegram.textsTo(ALICE)).toEqual([
      "That's not it. 4 tries left.",
      "That's not it. 3 tries left.",
      "That's not it. 2 tries left.",
      "That's not it. 1 try left.",
    ]);
    await guessWrong(1);
    expect(h.lastTextTo(ALICE)).toBe('Too many wrong tries. Show this to the organizers: ID 5001');
  });

  test('a locked account is refused even with the right passphrase, also after a restart', async () => {
    await guessWrong(5);
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe('Too many wrong tries. Show this to the organizers: ID 5001');
    h.restartBot();
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe('Too many wrong tries. Show this to the organizers: ID 5001');
  });

  test('unlock lets the account try again', async () => {
    await guessWrong(5);
    expect((await h.cli(['unlock', '5001'])).stdout).toBe('unlocked 5001; they can try the passphrase again\n');
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for <b>Swarm booth<\/b>:/);
  });

  test('unlock refuses an account with no wrong tries', async () => {
    expect((await h.cli(['unlock', '42'])).stderr).toBe('error: no wrong tries recorded for 42\n');
  });

  test('unlock refuses an account that only ever sent the right passphrase', async () => {
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for <b>Swarm booth<\/b>:/);
    const result = await h.cli(['unlock', '5001']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('error: no wrong tries recorded for 5001\n');
  });

  test('the right passphrase after 4 wrong ones delivers the code and gives the try back', async () => {
    await guessWrong(4);
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for <b>Swarm booth<\/b>:/);
    expect((await h.cli(['status'])).stdout).toMatch(/^Lockouts {2}0$/m);
  });

  test('--max-attempts sets the limit', async () => {
    h.close();
    h = new Harness();
    await h.openEvent({ extra: ['--max-attempts', '2'] });
    await guessWrong(1);
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 1 try left.");
    await guessWrong(1);
    expect(h.lastTextTo(ALICE)).toBe('Too many wrong tries. Show this to the organizers: ID 5001');
  });

  test('concurrent guesses cannot exceed the limit: the right one, sent 11th, is refused', async () => {
    const bot = h.bot({ rateLimit: { limit: 1000, windowMs: 2000 } });
    const guesses = [...Array.from({ length: 10 }, (_, i) => `guess ${i}`), PASSPHRASE];
    await Promise.all(guesses.map((text) => bot.handleUpdate(textUpdate(ALICE, text))));
    expect(h.telegram.textsTo(ALICE).some((t) => t.startsWith('Your gift code'))).toBe(false);
  });

  test('text over 200 characters counts as a wrong try', async () => {
    await h.say(ALICE, `${PASSPHRASE}${' '.repeat(200)}x`);
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 4 tries left.");
  });

  test('10-digit Telegram IDs (new accounts) lock out and unlock correctly', async () => {
    const NEW_ACCOUNT = 7_123_456_789;
    for (let i = 0; i < 5; i += 1) await h.say(NEW_ACCOUNT, `guess ${i}`);
    expect(h.lastTextTo(NEW_ACCOUNT)).toBe('Too many wrong tries. Show this to the organizers: ID 7123456789');
    await h.ok(['unlock', '7123456789']);
    await h.say(NEW_ACCOUNT, PASSPHRASE);
    expect(h.lastTextTo(NEW_ACCOUNT)).toMatch(/^Your gift code/);
  });

  test('when no codes are left, any text gets "all claimed" and uses no try', async () => {
    h.close();
    h = new Harness();
    await h.openEvent({ keys: [key(1)] });
    await h.say(5009, PASSPHRASE);
    await h.say(ALICE, 'wrong');
    expect(h.lastTextTo(ALICE)).toBe('All codes have been claimed.');
    await h.importKeys([key(2)]);
    await h.say(ALICE, 'wrong');
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 4 tries left.");
  });
});
