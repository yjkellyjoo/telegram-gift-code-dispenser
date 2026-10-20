import { Bot, BotError, type Context, type Middleware, type Transformer } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { Clock } from '../clock.js';
import { errorFields, type Logger } from '../log.js';
import { openDatabase } from '../store/db.js';
import { checkinTap } from './checkin-taps.js';
import { myCodeReply, notifyAdmin, startReply, textReply } from './claim-flow.js';
import type { Flow, Reply } from './flow.js';
import { handleGroupStatus } from './group-status.js';
import { msg, tripMessage } from './messages.js';
import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimit } from './rate-limit.js';

export interface BotDeps {
  token: string;
  botInfo: UserFromGetMe;
  dataDir: string;
  adminUserId: number;
  clock: Clock;
  log: Logger;
  /** Installed on the API client, e.g. auto-retry in production or the Telegram fake in tests. */
  transformers?: Transformer[];
  /** Installed ahead of every handler, e.g. the runner's sequentialize in production. */
  before?: Middleware<Context>[];
  rateLimit?: RateLimit;
}

export interface DispenserBot {
  bot: Bot;
  /** Handles one update the way the runner does: errors go to the bot's error handler. */
  handleUpdate(update: Update): Promise<void>;
  close(): void;
}

function updateType(update: Update): string {
  return Object.keys(update).find((key) => key !== 'update_id') ?? 'unknown';
}

export function createBot(deps: BotDeps): DispenserBot {
  const db = openDatabase(deps.dataDir);
  const bot = new Bot(deps.token, { botInfo: deps.botInfo });
  for (const transformer of deps.transformers ?? []) bot.api.config.use(transformer);
  for (const middleware of deps.before ?? []) bot.use(middleware);

  const flow: Flow = { db, clock: deps.clock, log: deps.log, adminUserId: deps.adminUserId, botId: deps.botInfo.id };
  const allow = createRateLimiter(deps.clock, deps.rateLimit ?? DEFAULT_RATE_LIMIT);
  const options = (reply: Reply) => (reply.html ? { parse_mode: 'HTML' as const } : {});

  bot.on('my_chat_member', (ctx) => handleGroupStatus(ctx.api, flow, ctx.myChatMember));

  const priv = bot.chatType('private');
  priv.use(async (ctx, next) => {
    if (allow(ctx.from.id)) await next();
  });
  priv.command('start', (ctx) => ctx.reply(startReply(flow, ctx.from.id)));
  priv.command('mycode', async (ctx) => {
    const reply = myCodeReply(flow, ctx.from.id);
    await ctx.reply(reply.text, options(reply));
  });
  priv.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply(startReply(flow, ctx.from.id));
      return;
    }
    let outcome;
    try {
      outcome = await textReply(ctx.api, flow, ctx.from.id, ctx.message.text);
    } catch (err) {
      flow.log.error('claim flow failed', { user: ctx.from.id, ...errorFields(err) });
      await ctx.reply(msg.somethingWrong);
      return;
    }
    try {
      await ctx.reply(outcome.reply.text, options(outcome.reply));
    } finally {
      if (outcome.trippedEvent) await notifyAdmin(ctx.api, flow, tripMessage(outcome.trippedEvent));
    }
  });
  priv.on('callback_query:data', async (ctx) => {
    const text = checkinTap(flow, ctx.from.id, ctx.callbackQuery.data);
    await ctx.answerCallbackQuery(text === null ? undefined : { text });
  });
  priv.on('message', (ctx) => ctx.reply(startReply(flow, ctx.from.id)));
  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery());

  bot.catch((err) => {
    deps.log.error('update failed', {
      updateId: err.ctx.update.update_id,
      updateType: updateType(err.ctx.update),
      ...errorFields(err.error),
    });
  });

  return {
    bot,
    async handleUpdate(update) {
      try {
        await bot.handleUpdate(update);
      } catch (err) {
        if (!(err instanceof BotError)) throw err;
        await bot.errorHandler(err);
      }
    },
    close: () => db.close(),
  };
}
