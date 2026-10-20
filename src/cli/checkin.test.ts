import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CHECKIN_KEYBOARD } from '../core/checkin.js';
import { Harness, PASSPHRASE } from '../test/harness.js';

const ALICE = 5001;
const BOB = 5002;
const CAROL = 5003;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
  await h.say(ALICE, PASSPHRASE); // 2026-11-14 10:00:01
  await h.say(BOB, PASSPHRASE);
  await h.say(CAROL, PASSPHRASE);
  await h.ok(['event', 'close']);
});
afterEach(() => h.close());

describe('dispenser checkin send', () => {
  test('refuses while the event is open', async () => {
    h.close();
    h = new Harness();
    await h.openEvent();
    expect((await h.cli(['checkin', 'send'])).stderr).toBe('error: send the check-in after the event has closed\n');
  });

  test('sends each claimant one message with the six answers, once', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    expect((await h.cli(['checkin', 'send'])).stdout).toBe('sent 3 · unreachable 0 · failed 0\n');
    const message = h.telegram.sent.find((s) => s.chatId === ALICE && s.text.startsWith('Hi!'));
    expect(message?.text).toBe('Hi! 7 days ago you got a Swarm gift code at Swarm booth.\nDid you upload your first file?');
    expect(message?.replyMarkup).toEqual(CHECKIN_KEYBOARD);
    expect((await h.cli(['checkin', 'send'])).stdout).toBe('sent 0 · unreachable 0 · failed 0\n');
    expect(h.telegram.sent.filter((s) => s.text.startsWith('Hi!'))).toHaveLength(3);
  });

  test('says "1 day ago" the day after', async () => {
    h.clock.set('2026-11-15T11:00:00Z');
    await h.ok(['checkin', 'send']);
    expect(h.lastTextTo(ALICE)).toMatch(/^Hi! 1 day ago /);
  });

  test('counts a blocked account as unreachable and a refused chat as failed, and never retries them', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    h.telegram.failNext('sendMessage', { error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    h.telegram.failNext('sendMessage', { error_code: 400, description: 'Bad Request: chat not found' });
    expect((await h.cli(['checkin', 'send'])).stdout).toBe('sent 1 · unreachable 1 · failed 1\n');
    expect((await h.cli(['checkin', 'send'])).stdout).toBe('sent 0 · unreachable 0 · failed 0\n');
  });

  test('stops at an error that is not about one recipient and sends the rest on the next run', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    h.telegram.failNext('sendMessage', { error_code: 401, description: 'Unauthorized' });
    const stopped = await h.cli(['checkin', 'send']);
    expect(stopped.code).toBe(1);
    expect(stopped.stdout).toBe('sent 0 · unreachable 0 · failed 1\n');
    expect(stopped.stderr).toMatch(/stopped after a send error/);
    expect(h.logs.some((line) => line.includes('"msg":"check-in send failed"') && line.includes('"errorCode":401'))).toBe(true);
    expect((await h.cli(['checkin', 'send'])).stdout).toBe('sent 2 · unreachable 0 · failed 0\n');
  });

  test('two overlapping runs still send each claimant one message', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    await Promise.all([h.cli(['checkin', 'send']), h.cli(['checkin', 'send'])]);
    expect(h.telegram.sent.filter((s) => s.text.startsWith('Hi!'))).toHaveLength(3);
  });
});
