import { describe, expect, test } from 'vitest';
import { renderMarkdown } from './markdown.js';

const html = (source: string) => renderMarkdown(source, true);

describe('instructions Markdown to Telegram HTML', () => {
  test('plain text keeps its lines and is HTML-escaped', () => {
    expect(html('Swarm <3 & co\n\nSecond line')).toBe('Swarm &lt;3 &amp; co\n\nSecond line');
  });

  test('a heading becomes a bold line, since Telegram has no headings', () => {
    expect(html('## What is this?\nText')).toBe('<b>What is this?</b>\nText');
  });

  test('bold inside a heading opens no second <b>', () => {
    expect(html('## **Nook** setup')).toBe('<b>Nook setup</b>');
  });

  test('#hashtag without a space stays text', () => {
    expect(html('#devcon')).toBe('#devcon');
  });

  test('**bold**', () => {
    expect(html('Press **Redeem gift code** now')).toBe('Press <b>Redeem gift code</b> now');
  });

  test('_italic_ and *italic*, also inside bold', () => {
    expect(html('Open _Account → Wallet_ or *Settings*')).toBe('Open <i>Account → Wallet</i> or <i>Settings</i>');
    expect(html('**Nook _first_**')).toBe('<b>Nook <i>first</i></b>');
  });

  test('snake_case, 2 * 3 * 4 and an unclosed ** stay text', () => {
    expect(html('swarm_bzz_gift and 2 * 3 * 4')).toBe('swarm_bzz_gift and 2 * 3 * 4');
    expect(html('**Redeem it')).toBe('**Redeem it');
  });

  test('`code` is monospace, escaped, and its content is not parsed', () => {
    expect(html('Token: `0xdB_F3*a*<b>`')).toBe('Token: <code>0xdB_F3*a*&lt;b&gt;</code>');
  });

  test('[text](url) becomes a link, with the URL escaped for the attribute', () => {
    expect(html('Get [**Nook**](https://example.com/a?x=1&y="2") here')).toBe(
      'Get <a href="https://example.com/a?x=1&amp;y=&quot;2&quot;"><b>Nook</b></a> here',
    );
  });

  test('a link that is not http or https stays text', () => {
    expect(html('[me](tg://user?id=1)')).toBe('[me](tg://user?id=1)');
  });

  test('a bare URL is left alone, underscores included, so Telegram links it', () => {
    expect(html('See https://example.com/_docs_/a_b and _this_')).toBe('See https://example.com/_docs_/a_b and <i>this</i>');
  });

  test('- and * list items become bullets, keeping their indent; numbered items stay as written', () => {
    expect(html('- MetaMask\n* **Rabby**\n  - nested\n1. First')).toBe(
      '• MetaMask\n• <b>Rabby</b>\n  • nested\n1. First',
    );
  });

  test('a backslash keeps a marker as text', () => {
    expect(html('\\- not a bullet, \\*not italic\\*, \\# and C:\\path')).toBe('- not a bullet, *not italic*, # and C:\\path');
  });

  test('the plain rendering is the text Telegram shows, for the length check', () => {
    expect(renderMarkdown('## Use it\n- [Nook](https://example.com/x) with `key` & **care**', false)).toBe(
      'Use it\n• Nook with key & care',
    );
  });
});
