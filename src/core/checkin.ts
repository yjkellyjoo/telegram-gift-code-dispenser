import type { InlineKeyboardMarkup } from 'grammy/types';
import { CHECKIN_ANSWERS, type CheckinAnswer } from '../store/codes.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const KPI_WINDOW_MS = 30 * DAY_MS;

/** True when `at` is after the claim and no later than 30 days after it. */
export function inKpiWindow(claimedAt: number, at: number): boolean {
  return at > claimedAt && at <= claimedAt + KPI_WINDOW_MS;
}

/** Accepts exactly `ci:<answer>`; anything else is null. */
export function parseCheckinData(data: string): CheckinAnswer | null {
  const answer = /^ci:([a-z_]+)$/.exec(data)?.[1];
  return CHECKIN_ANSWERS.find((a) => a === answer) ?? null;
}

export function checkinText(title: string, claimedAt: number, now: number): string {
  const days = Math.max(1, Math.floor((now - claimedAt) / DAY_MS));
  return `Hi! ${days} ${days === 1 ? 'day' : 'days'} ago you got a Swarm gift code at ${title}.\nDid you upload your first file?`;
}

export const CHECKIN_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: 'Yes', callback_data: 'ci:uploaded' },
      { text: 'Not yet', callback_data: 'ci:not_yet' },
    ],
    [
      { text: 'Stuck installing Bee', callback_data: 'ci:stuck_install' },
      { text: 'Stuck importing the key', callback_data: 'ci:stuck_import' },
    ],
    [
      { text: 'Stuck uploading', callback_data: 'ci:stuck_upload' },
      { text: 'Stuck on something else', callback_data: 'ci:stuck_other' },
    ],
  ],
};
