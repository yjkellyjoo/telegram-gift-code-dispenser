export const msg = {
  start: (title: string) =>
    `To get your gift code for ${title}, join the event's Telegram group, then send me the passphrase you were given.`,
  startHasCode: 'You already have a code. Send /mycode to see it again.',
  noEventOpen: 'No event is open right now.',
  noCodeYet: "You don't have a code yet.",
  noLongerStored: 'Codes are no longer stored. If you lost yours, ask the organizers.',
  paused: 'Claims are paused. Please check back soon.',
  lookupFailed: "Couldn't check the group right now. Please try again in a minute.",
  notMember: (title: string) => `This is for members of the ${title} group. Join it, then send the passphrase again.`,
  restricted: "Finish the group's verification first, then send the passphrase again.",
  lockedOut: (userId: number) => `Too many wrong tries. Show this to the organizers: ID ${userId}`,
  allClaimed: 'All codes have been claimed.',
  wrong: (left: number) => `That's not it. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
  somethingWrong: 'Something went wrong. Please try again later.',
};

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface Delivery {
  privateKey: string;
  address: string;
}

/** The code message. With html = false it is the text Telegram shows, used to check the length limit. */
export function renderDelivery(title: string, instructions: string, code: Delivery, html = true): string {
  const text = html ? escapeHtml : (t: string) => t;
  return [
    `Your gift code for ${text(title)}:`,
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
