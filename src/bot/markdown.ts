/**
 * The instructions file's Markdown, limited to what Telegram can show (spec §8.6).
 * Every tag written here is also closed here, and all other text is escaped, so a typo shows as text and never breaks a delivery.
 */

type Inline =
  | { kind: 'text' | 'code'; text: string }
  | { kind: 'bold' | 'italic'; children: Inline[] }
  | { kind: 'link'; url: string; children: Inline[] };

const WORD = /[\p{L}\p{N}]/u;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const LINK = /\[([^\]\n]+)\]\(([^\s)]+)\)/y;
const WEB_URL = /^https?:\/\//;
const BARE_URL = /https?:\/\/[^\s<>*]+/y;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** With html = false it is the text Telegram shows, used to check the length limit. */
export function renderMarkdown(source: string, html: boolean): string {
  return source
    .split('\n')
    .map((line) => {
      const heading = /^#{1,6}[ \t]+(.*)$/.exec(line);
      if (heading) return render([{ kind: 'bold', children: parseInline(heading[1] ?? '') }], html);
      const item = /^([ \t]*)[-*+][ \t]+(.*)$/.exec(line);
      if (item) return `${item[1] ?? ''}• ${render(parseInline(item[2] ?? ''), html)}`;
      return render(parseInline(line), html);
    })
    .join('\n');
}

/** The first `[text](url)` link whose URL is not http or https, with its line number from 1; such a link is sent as text. */
export function firstBadLink(source: string): { line: number; url: string } | undefined {
  const lines = source.split('\n');
  for (const [index, line] of lines.entries()) {
    const bad: string[] = [];
    parseInline(line, false, bad);
    if (bad[0] !== undefined) return { line: index + 1, url: bad[0] };
  }
  return undefined;
}

/** Inside a link, Telegram allows no code or other link, so those stay text. */
function parseInline(s: string, inLink = false, badUrls: string[] = []): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && ASCII_PUNCTUATION.test(s[i + 1] ?? '')) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (!inLink && s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: 'code', text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    LINK.lastIndex = i;
    const link = inLink ? null : LINK.exec(s);
    const url = link?.[2] ?? '';
    if (link && WEB_URL.test(url)) {
      flush();
      out.push({ kind: 'link', url, children: parseInline(link[1] ?? '', true) });
      i += link[0].length;
      continue;
    }
    if (link) badUrls.push(url);
    BARE_URL.lastIndex = i;
    const bare = WORD.test(s[i - 1] ?? '') ? null : BARE_URL.exec(s);
    if (bare) {
      text += bare[0];
      i += bare[0].length;
      continue;
    }
    if (s.startsWith('**', i) && /\S/.test(s[i + 2] ?? '')) {
      const end = closing(s, '**', i + 3);
      if (end !== -1) {
        flush();
        out.push({ kind: 'bold', children: parseInline(s.slice(i + 2, end), inLink, badUrls) });
        i = end + 2;
        continue;
      }
    }
    const marker = s[i];
    if ((marker === '_' || marker === '*') && s[i + 1] !== marker && !WORD.test(s[i - 1] ?? '') && /\S/.test(s[i + 1] ?? '')) {
      const end = closing(s, marker, i + 2, (after) => !WORD.test(after));
      if (end !== -1) {
        flush();
        out.push({ kind: 'italic', children: parseInline(s.slice(i + 1, end), inLink, badUrls) });
        i = end + 1;
        continue;
      }
    }
    text += s[i];
    i += 1;
  }
  flush();
  return out;
}

/** The next `marker` at or after `from` that follows a non-space and, if given, passes `fits` on the next character; or -1. */
function closing(s: string, marker: string, from: number, fits?: (after: string) => boolean): number {
  for (let j = s.indexOf(marker, from); j !== -1; j = s.indexOf(marker, j + 1)) {
    if (/\S/.test(s[j - 1] ?? '') && (!fits || fits(s[j + marker.length] ?? ''))) return j;
  }
  return -1;
}

/** `open` holds the tags around these nodes, so bold inside bold opens no second `<b>`. */
function render(nodes: Inline[], html: boolean, open: readonly string[] = []): string {
  const wrap = (tag: string, children: Inline[], attributes = '') =>
    !html || open.includes(tag)
      ? render(children, html, open)
      : `<${tag}${attributes}>${render(children, html, [...open, tag])}</${tag}>`;
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
          return html ? escapeHtml(node.text) : node.text;
        case 'code':
          return html ? `<code>${escapeHtml(node.text)}</code>` : node.text;
        case 'link':
          return wrap('a', node.children, ` href="${escapeHtml(node.url).replace(/"/g, '&quot;')}"`);
        case 'bold':
          return wrap('b', node.children);
        case 'italic':
          return wrap('i', node.children);
      }
    })
    .join('');
}
