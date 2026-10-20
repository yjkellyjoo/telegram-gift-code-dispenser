import { run, sequentialize } from '@grammyjs/runner';
import { Api, type Transformer } from 'grammy';
import { randomInt } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createBot } from './bot/create-bot.js';
import { runCli } from './cli/run-cli.js';
import { processTerminal, readAllStdin } from './cli/terminal.js';
import { systemClock } from './clock.js';
import { loadConfig, type Config } from './config.js';
import { createLogger, errorFields } from './log.js';
import { telegramRetry } from './telegram-retry.js';

const POLL_TIMEOUT_MS = 3 * 60 * 1000;

async function runBot(config: Config): Promise<void> {
  const log = createLogger((line) => process.stdout.write(`${line}\n`), [config.token], systemClock);
  process.on('unhandledRejection', (err) => {
    log.error('unhandled rejection', errorFields(err));
    process.exit(1);
  });

  let lastPollOk = Date.now();
  const watchPolling: Transformer = async (prev, method, payload, signal) => {
    const response = await prev(method, payload, signal);
    if (method === 'getUpdates' && response.ok) lastPollOk = Date.now();
    return response;
  };

  const botInfo = await new Api(config.token).getMe();
  const app = createBot({
    token: config.token,
    botInfo,
    dataDir: config.dataDir,
    adminUserId: config.adminUserId,
    clock: systemClock,
    log,
    transformers: [telegramRetry(), watchPolling],
    before: [sequentialize((ctx) => ctx.from?.id.toString())],
  });
  const runner = run(app.bot, {
    runner: { fetch: { allowed_updates: ['message', 'callback_query', 'my_chat_member'] } },
  });
  log.info('bot started', { username: botInfo.username });

  const watchdog = setInterval(() => {
    if (Date.now() - lastPollOk > POLL_TIMEOUT_MS) {
      log.error('polling has failed for 3 minutes; exiting so Docker restarts the bot');
      process.exit(1);
    }
  }, 30_000);

  const shutdown = async () => {
    clearInterval(watchdog);
    const drained = (async () => {
      await runner.stop();
      while (runner.size() > 0) await sleep(50);
    })();
    await Promise.race([drained, sleep(10_000)]);
    app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  await runner.task();
}

async function runDispenser(argv: string[], config: Config): Promise<number> {
  const result = await runCli(argv, readAllStdin, {
    dataDir: config.dataDir,
    token: config.token,
    defaultTz: config.tz,
    clock: systemClock,
    log: createLogger((line) => process.stderr.write(`${line}\n`), [config.token], systemClock),
    terminal: processTerminal(),
    randomInt: (max) => randomInt(max),
    transformers: [telegramRetry()],
    fetch,
    blockscoutUrl: config.blockscoutUrl,
    sleep: (ms) => sleep(ms),
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.code;
}

const [mode, ...rest] = process.argv.slice(2);
try {
  const config = loadConfig(process.env);
  if (mode === 'bot') await runBot(config);
  else if (mode === 'dispenser') process.exitCode = await runDispenser(rest, config);
  else {
    process.stderr.write('usage: main.js bot | main.js dispenser <command>\n');
    process.exitCode = 2;
  }
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
