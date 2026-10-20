import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { BOT_ID, GROUP_ID, Harness, PASSPHRASE } from '../test/harness.js';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.ok(['init']);
});
afterEach(() => h.close());

describe('dispenser event create', () => {
  test('creates the event and status shows it scheduled, in its time zone', async () => {
    const result = await h.createEvent();
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `created "Swarm booth" for group ${GROUP_ID} “Swarm booth chat”\n` +
        'open from 2026-11-14 10:00 UTC to 2026-11-14 18:00 UTC\n',
    );
    expect((await h.cli(['status'])).stdout).toMatch(/^Event     Swarm booth · SCHEDULED · opens 2026-11-14 10:00 UTC$/m);
  });

  test('reads and shows times in --tz', async () => {
    await h.ok(
      ['event', 'create', '--title', 'Swarm booth', `--group=${GROUP_ID}`, '--opens', '2026-11-14 10:00',
        '--closes', '2026-11-14 18:00', '--tz', 'Europe/Berlin', '--instructions', h.instructionsFile],
      { tty: true, answers: [PASSPHRASE, PASSPHRASE] },
    );
    h.clock.set('2026-11-14T09:30:00Z'); // 10:30 in Berlin
    expect((await h.cli(['status'])).stdout).toMatch(/OPEN · closes 2026-11-14 18:00 CET$/m);
  });

  test('refuses a second event', async () => {
    await h.createEvent();
    const again = await h.createEvent();
    expect(again.code).toBe(1);
    expect(again.stderr).toBe('error: an event already exists; this version holds one event per database\n');
  });

  test('refuses a group where the bot is not an admin', async () => {
    h.telegram.setStatus(GROUP_ID, BOT_ID, 'member');
    const result = await h.createEvent();
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/the bot is not an admin in -1001234567890 “Swarm booth chat” \(its status is member\)/);
    expect((await h.cli(['status'])).stdout).toMatch(/^No event yet/);
  });

  test('refuses a group Telegram does not know', async () => {
    h.telegram.failNext('getChat', { error_code: 400, description: 'Bad Request: chat not found' });
    const result = await h.createEvent();
    expect(result.stderr).toBe('error: could not check group -1001234567890: Bad Request: chat not found\n');
  });

  test('the passphrase prompt needs a terminal', async () => {
    const result = await h.cli(['event', 'create', '--title', 'T', `--group=${GROUP_ID}`, '--opens',
      '2026-11-14 10:00', '--closes', '2026-11-14 18:00', '--instructions', h.instructionsFile]);
    expect(result.stderr).toMatch(/needs a terminal.*--passphrase-generate/);
  });

  test('refuses mismatched or short passphrases', async () => {
    const args = ['event', 'create', '--title', 'T', `--group=${GROUP_ID}`, '--opens', '2026-11-14 10:00',
      '--closes', '2026-11-14 18:00', '--instructions', h.instructionsFile];
    expect((await h.cli(args, { tty: true, answers: ['orbit maple', 'orbit maples'] })).stderr).toBe(
      'error: the passphrases do not match\n',
    );
    expect((await h.cli(args, { tty: true, answers: ['  a  b ', '  a  b '] })).stderr).toBe(
      'error: the passphrase must have at least 8 characters\n',
    );
  });

  test('--passphrase-generate prints three words from the EFF short list, once', async () => {
    h.randomInts = [0, 1, 1295];
    const result = await h.createEvent(['--passphrase-generate']);
    expect(result.stdout).toMatch(/^passphrase: acid acorn zoom$/m);
  });

  test.each([
    [['--opens', '2026-11-14 18:00', '--closes', '2026-11-14 10:00'], 'error: --opens must be before --closes\n'],
    [['--opens', '2026-11-13 10:00', '--closes', '2026-11-13 18:00'], 'error: --closes must be in the future\n'],
    [['--opens', '14.11.2026 10:00'], 'error: --opens must look like "YYYY-MM-DD HH:mm", got "14.11.2026 10:00"\n'],
    [['--opens', '2026-02-30 10:00'], 'error: --opens must look like "YYYY-MM-DD HH:mm", got "2026-02-30 10:00"\n'],
    [['--tz', 'Mars/Olympus'], 'error: unknown time zone "Mars/Olympus"\n'],
    [['--trip-rate', '5/5'], 'error: --trip-rate must be <n>/<seconds>, with n at least 1 and seconds from 10 to 3600\n'],
    [['--max-attempts', '0'], 'error: --max-attempts must be a whole number from 1 to 100\n'],
    [['--group=12345'], `error: --group must be a whole number from ${Number.MIN_SAFE_INTEGER} to -1\n`],
  ])('refuses %j', async (override, error) => {
    expect((await h.createEvent(override)).stderr).toBe(error);
  });

  test('refuses instructions that would push the code message over 4,096 characters', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(h.instructionsFile, 'x'.repeat(4000));
    expect((await h.createEvent()).stderr).toMatch(/^error: the code message would be 4\d{3} characters; Telegram allows 4096/);
  });
});
