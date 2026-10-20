import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE } from '../test/harness.js';

const ALICE = 5001;
const STRANGER = 6666;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
  await h.say(ALICE, PASSPHRASE); // claimed at 2026-11-14 10:00:01 UTC
  await h.ok(['event', 'close']);
});
afterEach(() => h.close());

const lastAnswer = () => h.telegram.callbackAnswers.at(-1)?.text;
const statsLine = async () => (await h.cli(['stats'])).stdout.split('\n').find((l) => l.trimStart().startsWith('uploaded'));

describe('check-in taps', () => {
  beforeEach(() => {
    h.fetch = async () => Response.json({ items: [], next_page_params: null });
  });

  test('a tap before the check-in was sent gets an empty answer', async () => {
    await h.tap(ALICE, 'ci:uploaded');
    expect(lastAnswer()).toBeUndefined();
  });

  test("stores the claimant's answer, and a later tap replaces it", async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    await h.ok(['checkin', 'send']);
    await h.tap(ALICE, 'ci:not_yet');
    expect(lastAnswer()).toBe('Thanks! You can tap again to change your answer.');
    await h.tap(ALICE, 'ci:uploaded');
    expect(await statsLine()).toBe('          uploaded 1 · not yet 0 · stuck 0 (installing 0 · key 0 · uploading 0 · other 0)');
  });

  test('a tap from an account without a code is not stored', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    await h.ok(['checkin', 'send']);
    await h.tap(STRANGER, 'ci:uploaded');
    expect(lastAnswer()).toBeUndefined();
    expect(await statsLine()).toMatch(/uploaded 0 /);
  });

  test('closes 30 days after the claim', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    await h.ok(['checkin', 'send']);
    h.clock.set('2026-12-14T10:00:00Z'); // tap() adds 1 s: this tap lands exactly at the end of day 30
    await h.tap(ALICE, 'ci:stuck_install');
    expect(lastAnswer()).toBe('Thanks! You can tap again to change your answer.');
    h.clock.set('2026-12-14T10:00:01Z');
    await h.tap(ALICE, 'ci:uploaded');
    expect(lastAnswer()).toBe('This check-in has closed.');
    expect(await statsLine()).toMatch(/stuck 1 \(installing 1 /);
  });
});
