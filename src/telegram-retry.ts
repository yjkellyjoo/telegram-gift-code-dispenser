import { autoRetry } from '@grammyjs/auto-retry';
import type { Transformer } from 'grammy';

/** Retries 429s and Telegram server errors a few times; network failures are rethrown at once. */
export function telegramRetry(): Transformer {
  return autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60, rethrowHttpErrors: true });
}
