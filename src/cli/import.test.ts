import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness } from '../test/harness.js';
import { key } from '../test/keys.js';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.ok(['init']);
  await h.createEvent();
});
afterEach(() => h.close());

const claimsLine = async () => (await h.cli(['status'])).stdout.match(/^Claims .*$/m)?.[0];

describe('dispenser import', () => {
  test('is a dry run without --yes', async () => {
    const result = await h.cli(['import', '-'], { stdin: `${key(1)}\n${key(2)}` });
    expect(result.stdout).toBe('parsed 2 keys; nothing imported (dry run). Run again with --yes to import.\n');
    expect(await claimsLine()).toBe('Claims    0 claimed · 0 left');
  });

  test('imports with --yes', async () => {
    const result = await h.cli(['import', '-', '--yes'], { stdin: `${key(1)}\n${key(2)}\n${key(3)}\n` });
    expect(result.stdout).toBe('imported 3 keys\n');
    expect(await claimsLine()).toBe('Claims    0 claimed · 3 left');
  });

  test('reads a file path', async () => {
    const { writeFileSync } = await import('node:fs');
    const path = `${h.dir}/keys.txt`;
    writeFileSync(path, key(1));
    expect((await h.cli(['import', path, '--yes'])).stdout).toBe('imported 1 keys\n');
  });

  test('aborts on any bad line, imports nothing, and never echoes a key', async () => {
    const bad = `0x${'0'.repeat(64)}`;
    const result = await h.cli(['import', '-', '--yes'], { stdin: `${key(1)}\n${bad}\n${key(1)}` });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'line 2: not a valid private key\nline 3: duplicate of line 1\n' +
        'error: import aborted: 2 problem(s); nothing was imported\n',
    );
    expect(result.stdout + result.stderr).not.toContain(key(1).slice(2));
    expect(await claimsLine()).toBe('Claims    0 claimed · 0 left');
  });

  test('aborts when a key is already in the database', async () => {
    await h.importKeys([key(1)]);
    const result = await h.cli(['import', '-', '--yes'], { stdin: `${key(2)}\n${key(1)}` });
    expect(result.stderr).toMatch(/^line 2: this key is already in the database\n/);
    expect(await claimsLine()).toBe('Claims    0 claimed · 1 left');
  });

  test('refuses empty input', async () => {
    expect((await h.cli(['import', '-', '--yes'], { stdin: '\n\n' })).stderr).toBe('error: no keys found in the input\n');
  });
});
