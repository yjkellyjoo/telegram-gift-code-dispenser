import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { key } from '../test/keys.js';

const ALICE = 5001;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
  await h.say(ALICE, PASSPHRASE); // claims key(1)
});
afterEach(() => h.close());

const checksumOf = (stderr: string): string => /^checksum: ([0-9a-f]{16}) \(\d+ codes\)$/m.exec(stderr)?.[1] ?? '';

describe('dispenser export', () => {
  test('refuses while the event is open', async () => {
    expect((await h.cli(['export'])).stderr).toBe(
      'error: the event is still open; close it first with "dispenser event close"\n',
    );
  });

  test('writes exactly the unclaimed keys to stdout, and the checksum to stderr', async () => {
    await h.ok(['event', 'close']);
    const result = await h.cli(['export']);
    expect(result.stdout).toBe(`${key(2)}\n${key(3)}\n`);
    expect(result.stderr).toMatch(/^checksum: [0-9a-f]{16} \(2 codes\)\n$/);
  });
});

describe('dispenser wipe', () => {
  test('refuses before an export, and with a wrong checksum, deleting nothing', async () => {
    await h.ok(['event', 'close']);
    expect((await h.cli(['wipe', '--checksum', '0123456789abcdef'])).stderr).toBe(
      'error: run "dispenser export" first, and keep its output\n',
    );
    await h.ok(['export']);
    expect((await h.cli(['wipe', '--checksum', '0123456789abcdef'])).stderr).toBe(
      'error: the checksum does not match the last export; nothing was deleted\n',
    );
    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code/);
  });

  test('deletes every key from the database files, keeps the claim log, and can run again', async () => {
    await h.ok(['event', 'close']);
    const sum = checksumOf((await h.ok(['export'])).stderr);
    expect((await h.cli(['wipe', '--checksum', sum])).stdout).toBe('wiped 3 keys; the claim log is kept\n');

    const bytes = readdirSync(h.dataDir)
      .filter((f) => f.startsWith('dispenser.db'))
      .map((f) => readFileSync(join(h.dataDir, f)).toString('latin1'))
      .join('');
    for (const n of [1, 2, 3]) expect(bytes).not.toContain(key(n).slice(2));

    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toBe('Codes are no longer stored. If you lost yours, ask the organizers.');
    expect((await h.cli(['status'])).stdout).toMatch(/^Claims    1 claimed · 0 left/m);
    expect((await h.cli(['wipe', '--checksum', sum])).stdout).toBe('wiped 0 keys; the claim log is kept\n');
  });
});
