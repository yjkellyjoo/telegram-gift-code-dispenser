import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { textUpdate } from '../test/updates.js';

const ALICE = 5001;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

describe('rate limit', () => {
  test('an account may send 3 updates per 2 seconds; the rest are dropped silently', async () => {
    for (let i = 0; i < 5; i += 1) await h.send(textUpdate(ALICE, `guess ${i}`));
    expect(h.telegram.textsTo(ALICE)).toHaveLength(3);
    h.clock.advance(2000);
    await h.send(textUpdate(ALICE, PASSPHRASE));
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code/);
  });
});
