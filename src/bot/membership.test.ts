import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GROUP_ID, Harness, PASSPHRASE } from '../test/harness.js';
import type { MemberStatus } from '../test/telegram-fake.js';

const ALICE = 5001;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

const triesLeftAfterOneWrong = async (): Promise<string | undefined> => {
  h.telegram.setStatus(GROUP_ID, ALICE, 'member');
  await h.say(ALICE, 'wrong guess');
  return h.lastTextTo(ALICE);
};

describe('group membership', () => {
  test.each<[MemberStatus, string]>([
    ['left', 'This is for members of the Swarm booth group. Join it, then send the passphrase again.'],
    ['kicked', 'This is for members of the Swarm booth group. Join it, then send the passphrase again.'],
    ['restricted', "Finish the group's verification first, then send the passphrase again."],
  ])('%s: refused before the passphrase is checked, and no try is used', async (status, reply) => {
    h.telegram.setStatus(GROUP_ID, ALICE, status);
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe(reply);
    expect(await triesLeftAfterOneWrong()).toBe("That's not it. 4 tries left.");
  });

  test.each<MemberStatus>(['creator', 'administrator', 'member'])('%s: may claim', async (status) => {
    h.telegram.setStatus(GROUP_ID, ALICE, status);
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for Swarm booth:/);
  });

  test('a failed lookup fails closed: no code, and no try used', async () => {
    h.telegram.failNext('getChatMember', { error_code: 400, description: 'Bad Request: member list is inaccessible' });
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe("Couldn't check the group right now. Please try again in a minute.");
    expect(await triesLeftAfterOneWrong()).toBe("That's not it. 4 tries left.");
  });

  test('a claimant who leaves the group keeps the code', async () => {
    await h.say(ALICE, PASSPHRASE);
    h.telegram.setStatus(GROUP_ID, ALICE, 'left');
    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for Swarm booth:/);
  });
});
