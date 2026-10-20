import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GROUP_ID, Harness, PASSPHRASE } from '../test/harness.js';
import { callbackUpdate, locationUpdate, supergroup, textUpdate } from '../test/updates.js';

const ALICE = 5001;
const START = "To get your gift code for Swarm booth, join the event's Telegram group, then send me the passphrase you were given.";

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

describe('input rules', () => {
  test('messages in groups get no reply, even the passphrase', async () => {
    await h.send(textUpdate(ALICE, PASSPHRASE, supergroup(GROUP_ID, 'Swarm booth chat')));
    await h.send(textUpdate(ALICE, '/start', supergroup(GROUP_ID, 'Swarm booth chat')));
    expect(h.telegram.sent).toEqual([]);
  });

  test('other commands and non-text messages get the /start reply and use no try', async () => {
    await h.say(ALICE, '/help');
    await h.send(locationUpdate(ALICE));
    expect(h.telegram.textsTo(ALICE)).toEqual([START, START]);
    await h.say(ALICE, 'wrong');
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 4 tries left.");
  });

  test('malformed or unknown button data gets an empty answer and nothing else', async () => {
    await h.say(ALICE, PASSPHRASE);
    const before = h.telegram.sent.length;
    for (const data of ['ev:1', 'ci:uploaded ', 'ci:', 'ci:deleted', 'x'.repeat(64)]) await h.tap(ALICE, data);
    await h.send(callbackUpdate(ALICE, 'ci:uploaded', supergroup(GROUP_ID, 'Swarm booth chat')));
    expect(h.telegram.callbackAnswers.map((a) => a.text)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(h.telegram.sent.length).toBe(before);
  });


  test('a network failure during the lookup fails closed too', async () => {
    h.telegram.failNext('getChatMember', new Error('socket hang up'));
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe("Couldn't check the group right now. Please try again in a minute.");
  });
});
