import type { EventRow } from '../store/events.js';

/** Plain text, except `start` and `notMember`: those are HTML, with the names escaped and in bold. */
export const msg = {
  start: (title: string, groupTitle: string) =>
    `To get your gift code for ${bold(title)}, join ${bold(groupTitle)} on Telegram, then send me the passphrase you were given.`,
  startHasCode: 'You already have a code. Send /mycode to see it again.',
  noEventOpen: 'No event is open right now.',
  noCodeYet: "You don't have a code yet.",
  noLongerStored: 'Codes are no longer stored. If you lost yours, ask the organizers.',
  paused: 'Claims are paused. Please check back soon.',
  lookupFailed: "Couldn't check the group right now. Please try again in a minute.",
  notMember: (groupTitle: string) => `This is for members of ${bold(groupTitle)}. Join it, then send the passphrase again.`,
  restricted: "Finish the group's verification first, then send the passphrase again.",
  lockedOut: (userId: number) => `Too many wrong tries. Show this to the organizers: ID ${userId}`,
  allClaimed: 'All codes have been claimed.',
  wrong: (left: number) => `That's not it. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
  somethingWrong: 'Something went wrong. Please try again later.',
};

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bold(text: string): string {
  return `<b>${escapeHtml(text)}</b>`;
}

export interface Delivery {
  privateKey: string;
  address: string;
}

/** The code message. With html = false it is the text Telegram shows, used to check the length limit. */
export function renderDelivery(title: string, instructions: string, code: Delivery, html = true): string {
  const text = html ? escapeHtml : (t: string) => t;
  return [
    `Your gift code for ${html ? bold(title) : title}:`,
    html ? `<tg-spoiler><code>${text(code.privateKey)}</code></tg-spoiler>` : code.privateKey,
    `Wallet address: ${html ? `<code>${text(code.address)}</code>` : code.address}`,
    '',
    text(instructions),
    '',
    'Save your code somewhere safe now: the bot deletes all codes shortly after the event.',
    'Lost this message? Send /mycode to see it again.',
  ].join('\n');
}

export const MAX_MESSAGE_LENGTH = 4096;

export function deliveryLength(title: string, instructions: string): number {
  const placeholder = { privateKey: `0x${'0'.repeat(64)}`, address: `0x${'0'.repeat(40)}` };
  return renderDelivery(title, instructions, placeholder, false).length;
}

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

export function tripMessage(event: EventRow): string {
  return [
    `🔴 ${event.title}: claims paused`,
    `Claim burst: a ${ordinal(event.tripCount + 1)} claim within ${event.tripSeconds} s (limit ${event.tripCount} per ${event.tripSeconds} s).`,
    'Codes already claimed can still be re-sent.',
    'Check:  dispenser status',
    'Resume: dispenser resume',
  ].join('\n');
}
