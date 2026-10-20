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
