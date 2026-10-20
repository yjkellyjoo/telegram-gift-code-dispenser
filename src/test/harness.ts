import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Transformer } from 'grammy';
import type { Update } from 'grammy/types';
import { createBot, type DispenserBot } from '../bot/create-bot.js';
import type { RateLimit } from '../bot/rate-limit.js';
import { runCli, type CliResult } from '../cli/run-cli.js';
import { createLogger, type Logger } from '../log.js';
import { FakeClock } from './fake-clock.js';
import { key } from './keys.js';
import { TelegramFake } from './telegram-fake.js';
import { callbackUpdate, textUpdate } from './updates.js';

export const TOKEN = '777000:AAH-test-token-secret-value';
export const BOT_ID = 777000;
export const ADMIN_ID = 1000;
export const GROUP_ID = -1001234567890;
export const PASSPHRASE = 'Orbit Maple Lantern';
export const INSTRUCTIONS = 'Import the key into your Bee node: https://docs.ethswarm.org';

/** The code message as spec §8.6 words it, written out by hand. */
export function deliveryText(privateKey: string, address: string, title = 'Swarm booth'): string {
  return [
    `Your gift code for ${title}:`,
    `<tg-spoiler><code>${privateKey}</code></tg-spoiler>`,
    `Wallet address: <code>${address}</code>`,
    '',
    INSTRUCTIONS,
    '',
    'Save your code somewhere safe now: the bot deletes all codes shortly after the event.',
    'Lost this message? Send /mycode to see it again.',
  ].join('\n');
}

export interface CliOptions {
  stdin?: string;
  tty?: boolean;
  answers?: string[];
  /** Installed after the Telegram fake, so they wrap it, as production transformers wrap the real transport. */
  transformers?: Transformer[];
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
  private current: DispenserBot | undefined;

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
      transformers: [this.telegram.transformer, ...(options.transformers ?? [])],
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

  importKeys(keys: readonly string[]): Promise<CliResult> {
    return this.ok(['import', '-', '--yes'], { stdin: keys.join('\n') });
  }

  /** init → event create → import → clock at the opening time, 2026-11-14 10:00 UTC. */
  async openEvent(options: { keys?: readonly string[]; extra?: string[] } = {}): Promise<void> {
    await this.ok(['init']);
    const created = await this.createEvent(options.extra);
    if (created.code !== 0) throw new Error(`event create failed:\n${created.stderr}`);
    await this.importKeys(options.keys ?? [key(1), key(2), key(3)]);
    this.clock.set('2026-11-14T10:00:00Z');
  }

  bot(options: { rateLimit?: RateLimit } = {}): DispenserBot {
    this.current ??= createBot({
      token: TOKEN,
      botInfo: this.telegram.botInfo,
      dataDir: this.dataDir,
      adminUserId: ADMIN_ID,
      clock: this.clock,
      log: this.log,
      transformers: [this.telegram.transformer],
      ...options,
    });
    return this.current;
  }

  /** A new bot process over the same data directory. */
  restartBot(): DispenserBot {
    this.current?.close();
    this.current = undefined;
    return this.bot();
  }

  send(update: Update): Promise<void> {
    return this.bot().handleUpdate(update);
  }

  /** A private message one second after the previous one, so the default rate limit never drops it. */
  async say(userId: number, text: string): Promise<void> {
    this.clock.advance(1000);
    await this.send(textUpdate(userId, text));
  }

  async tap(userId: number, data: string): Promise<void> {
    this.clock.advance(1000);
    await this.send(callbackUpdate(userId, data));
  }

  lastTextTo(chatId: number): string | undefined {
    return this.telegram.textsTo(chatId).at(-1);
  }

  close(): void {
    this.current?.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}
