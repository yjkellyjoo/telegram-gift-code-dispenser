import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness } from '../test/harness.js';

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.close());

describe('dispenser init', () => {
  test('creates the database, after which status works', async () => {
    expect((await h.cli(['init'])).code).toBe(0);
    expect((await h.cli(['status'])).stdout).toBe('No event yet. Create one with "dispenser event create".\n');
  });

  test('refuses to run twice, so a live event can never be reset', async () => {
    await h.ok(['init']);
    const again = await h.cli(['init']);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/^error: a database already exists at /);
  });

  test('every other command refuses without a database', async () => {
    const result = await h.cli(['status']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/run "dispenser init" first/);
  });

  test('an unknown command prints the usage with exit code 2', async () => {
    const result = await h.cli(['frobnicate']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^usage: dispenser <command>/);
  });

  test('an unknown flag is an error, not ignored', async () => {
    const result = await h.cli(['init', '--force']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^error: .*--force/);
  });
});
