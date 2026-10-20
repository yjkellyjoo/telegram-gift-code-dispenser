import { isTimeZone } from './time.js';

export interface Config {
  token: string;
  adminUserId: number;
  tz: string;
  dataDir: string;
  blockscoutUrl: string;
}

/** Reads bot.env. Throws a message naming the variable that is wrong, never its value. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const token = env.BOT_TOKEN ?? '';
  if (!/^\d+:[\w-]{20,}$/.test(token)) throw new Error('BOT_TOKEN is missing or malformed');
  const adminUserId = Number(env.ADMIN_USER_ID);
  if (!Number.isSafeInteger(adminUserId) || adminUserId <= 0) {
    throw new Error('ADMIN_USER_ID must be your numeric Telegram user ID');
  }
  const tz = env.TZ ?? 'UTC';
  if (!isTimeZone(tz)) throw new Error('TZ is not a known time zone');
  return {
    token,
    adminUserId,
    tz,
    dataDir: env.DATA_DIR ?? '/data',
    blockscoutUrl: env.BLOCKSCOUT_URL ?? 'https://gnosisscan.io',
  };
}
