import { GrammyError } from 'grammy';
import type { Clock } from './clock.js';

/** Only primitives, so an update, a payload or an error object can never be logged whole. */
export type LogFields = Record<string, string | number | boolean | null>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** JSON-lines logger that scrubs every secret by value. */
export function createLogger(write: (line: string) => void, secrets: readonly string[], clock: Clock): Logger {
  const scrub = (line: string): string =>
    secrets.filter((s) => s.length > 0).reduce((out, s) => out.split(s).join('[redacted]'), line);
  const emit = (level: 'info' | 'warn' | 'error') => (msg: string, fields: LogFields = {}) =>
    write(scrub(JSON.stringify({ time: new Date(clock.now()).toISOString(), level, msg, ...fields })));
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/** What may be logged about an error: its kind and Telegram's error code, never its payload. */
export function errorFields(err: unknown): LogFields {
  if (err instanceof GrammyError) return { error: 'GrammyError', errorCode: err.error_code, method: err.method };
  if (err instanceof Error) return { error: err.name };
  return { error: typeof err };
}
