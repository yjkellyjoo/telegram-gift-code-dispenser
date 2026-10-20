import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ADMIN_ID, BOT_ID, GROUP_ID, Harness } from '../test/harness.js';
import type { MemberStatus } from '../test/telegram-fake.js';
import { botStatusUpdate, supergroup } from '../test/updates.js';

const OTHER_GROUP = -1009999999999;
const STRANGER = 6666;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

const change = (chatId: number, title: string, by: number, from: MemberStatus, to: MemberStatus) =>
  h.send(botStatusUpdate({ chat: supergroup(chatId, title), by, botId: BOT_ID, from, to }));

describe('the bot added to or changed in a group', () => {
  test('promoted by the admin: tells the admin the chat ID and how to use it', async () => {
    await change(OTHER_GROUP, 'New event chat', ADMIN_ID, 'member', 'administrator');
    expect(h.telegram.textsTo(ADMIN_ID)).toEqual([
      "I'm now an admin in “New event chat” (ID -1009999999999).\nUse it as: dispenser event create --group=-1009999999999 …",
    ]);
  });

  test('added as a member by the admin: asks to be made an admin', async () => {
    await change(OTHER_GROUP, 'New event chat', ADMIN_ID, 'left', 'member');
    expect(h.lastTextTo(ADMIN_ID)).toBe(
      "I'm now a member of “New event chat” (ID -1009999999999). Make me an admin so I can check membership.",
    );
  });

  test('added by anyone else: leaves without a word and tells no one', async () => {
    await change(OTHER_GROUP, 'Look-alike chat', STRANGER, 'left', 'member');
    expect(h.telegram.leftChats).toEqual([OTHER_GROUP]);
    expect(h.telegram.sent).toEqual([]);
  });

  test('demoted in the event group by someone else: warns the admin that claims fail', async () => {
    await change(GROUP_ID, 'Swarm booth chat', STRANGER, 'administrator', 'member');
    expect(h.lastTextTo(ADMIN_ID)).toBe(
      'My status in “Swarm booth chat” (ID -1001234567890) is now member.\n' +
        'The group check fails, and nobody can claim, until you make me an admin again.',
    );
  });

  test('demoted in the event group by the admin: one message, with the warning appended', async () => {
    await change(GROUP_ID, 'Swarm booth chat', ADMIN_ID, 'administrator', 'member');
    expect(h.telegram.textsTo(ADMIN_ID)).toEqual([
      "I'm now a member of “Swarm booth chat” (ID -1001234567890). Make me an admin so I can check membership.\n" +
        'The group check fails, and nobody can claim, until you make me an admin again.',
    ]);
  });

  test("ignores the update caused by the bot's own leaving", async () => {
    await change(OTHER_GROUP, 'Look-alike chat', BOT_ID, 'member', 'left');
    expect(h.telegram.sent).toEqual([]);
  });
});
