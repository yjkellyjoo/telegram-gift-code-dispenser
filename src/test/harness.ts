import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, type CliResult } from '../cli/run-cli.js';
import { createLogger, type Logger } from '../log.js';
import { FakeClock } from './fake-clock.js';
import { TelegramFake } from './telegram-fake.js';

export const TOKEN = '777000:AAH-test-token-secret-value';
export const BOT_ID = 777000;
export const ADMIN_ID = 1000;
export const GROUP_ID = -1001234567890;
export const PASSPHRASE = 'Orbit Maple Lantern';
export const INSTRUCTIONS = 'Import the key into your Bee node: https://docs.ethswarm.org';

export interface CliOptions {
  stdin?: string;
  tty?: boolean;
  answers?: string[];
}

/** One temp data directory with a fake clock, a fake Telegram and captured logs, driven through the seams. */
export class Harness {
  readonly dir = mkdtempSync(join(tmpdir(), 'dispenser-'));
  readonly dataDir = this.dir;
  readonly instructionsFile = join(this.dir, 'instructions.txt');
  readonly clock = new FakeClock(Date.parse('2026-11-14T09:00:00Z'));
  readonly telegram = new TelegramFake(BOT_ID, GROUP_ID);
  readonly logs: string[] = [];
  readonly log: Logger = createLogger((line) => this.logs.push(line), [TOKEN], this.clock);
  /** Consumed by randomInt in order; 0 once empty. */
  randomInts: number[] = [];
  fetch: typeof fetch = async () => {
    throw new Error('unexpected fetch');
  };
  readonly sleeps: number[] = [];

  constructor() {
    writeFileSync(this.instructionsFile, INSTRUCTIONS);
  }

  cli(argv: string[], options: CliOptions = {}): Promise<CliResult> {
    const answers = [...(options.answers ?? [])];
    return runCli(argv, async () => options.stdin ?? '', {
      dataDir: this.dataDir,
      token: TOKEN,
      defaultTz: 'UTC',
      clock: this.clock,
      log: this.log,
      terminal: { isTTY: options.tty ?? false, ask: async () => answers.shift() ?? '' },
      randomInt: (max) => {
        const n = this.randomInts.shift() ?? 0;
        if (n >= max) throw new RangeError(`randomInt(${max}) cannot return ${n}`);
        return n;
      },
      transformers: [this.telegram.transformer],
      fetch: (input, init) => this.fetch(input, init),
      blockscoutUrl: 'https://blockscout.test',
      sleep: async (ms) => {
        this.sleeps.push(ms);
      },
    });
  }

  /** Runs a CLI command that must succeed, for test setup. */
  async ok(argv: string[], options: CliOptions = {}): Promise<CliResult> {
    const result = await this.cli(argv, options);
    if (result.code !== 0) throw new Error(`dispenser ${argv.join(' ')} failed:\n${result.stderr}`);
    return result;
  }

  createEvent(extra: string[] = []): Promise<CliResult> {
    return this.cli(
      [
        'event', 'create', '--title', 'Swarm booth', `--group=${GROUP_ID}`,
        '--opens', '2026-11-14 10:00', '--closes', '2026-11-14 18:00', '--tz', 'UTC',
        '--instructions', this.instructionsFile, ...extra,
      ],
      { tty: true, answers: [PASSPHRASE, PASSPHRASE] },
    );
  }

  close(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
