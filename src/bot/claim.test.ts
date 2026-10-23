import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createBot } from './create-bot.js';
import { ADMIN_ID, deliveryText, Harness, PASSPHRASE, TOKEN } from '../test/harness.js';
import { ADDRESS_1, key } from '../test/keys.js';

const ALICE = 5001;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

describe('claiming a code', () => {
  test('/start explains what to do, with the event and the group in bold', async () => {
    await h.say(ALICE, '/start');
    expect(h.lastTextTo(ALICE)).toBe(
      'To get your gift code for <b>Swarm booth</b>, join <b>Swarm booth chat</b> on Telegram, then send me the passphrase you were given.',
    );
    expect(h.telegram.sent.at(-1)?.parseMode).toBe('HTML');
  });

  test('the right passphrase delivers the first code as a spoiler, with the address and instructions', async () => {
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe(deliveryText(key(1), ADDRESS_1));
    expect(h.telegram.sent.at(-1)?.parseMode).toBe('HTML');
  });

  test('the passphrase matches regardless of case and spacing', async () => {
    await h.say(ALICE, '  orbit   MAPLE lantern ');
    expect(h.lastTextTo(ALICE)).toBe(deliveryText(key(1), ADDRESS_1));
  });

  test('phone keyboards: non-breaking spaces, em spaces and full-width letters still match', async () => {
    await h.say(ALICE, '\u00a0Orbit\u2003maple ＬＡＮＴＥＲＮ');
    expect(h.lastTextTo(ALICE)).toBe(deliveryText(key(1), ADDRESS_1));
  });

  test('escapes HTML in the title, group name and instructions, so Telegram accepts the messages', async () => {
    h.close();
    h = new Harness();
    h.telegram.groupTitle = 'Swarm <3 & friends';
    writeFileSync(h.instructionsFile, 'Docs: https://docs.ethswarm.org/?a=1&b=<2>');
    await h.openEvent({ extra: ['--title', 'Swarm <3 & co'] });
    await h.say(ALICE, '/start');
    expect(h.lastTextTo(ALICE)).toMatch(
      /^To get your gift code for <b>Swarm &lt;3 &amp; co<\/b>, join <b>Swarm &lt;3 &amp; friends<\/b> on Telegram,/,
    );
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for <b>Swarm &lt;3 &amp; co<\/b>:\n/);
    expect(h.lastTextTo(ALICE)).toContain('\nDocs: https://docs.ethswarm.org/?a=1&amp;b=&lt;2&gt;\n');
  });

  test("the instructions' Markdown is formatted in the code message", async () => {
    h.close();
    h = new Harness();
    writeFileSync(h.instructionsFile, '## Use it\n- Get [Nook](https://example.com/nook) and press **Redeem**');
    await h.openEvent();
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toContain('\n\n<b>Use it</b>\n• Get <a href="https://example.com/nook">Nook</a> and press <b>Redeem</b>\n\n');
  });

  test('a wrong passphrase says how many tries are left', async () => {
    await h.say(ALICE, 'hello?');
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 4 tries left.");
  });

  test('the bot refuses to start without a database', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dispenser-empty-'));
    try {
      expect(() =>
        createBot({ token: TOKEN, botInfo: h.telegram.botInfo, dataDir: empty, adminUserId: ADMIN_ID, clock: h.clock, log: h.log }),
      ).toThrow(/no database at .*run "dispenser init" first/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
