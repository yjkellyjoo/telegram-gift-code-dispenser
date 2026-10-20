import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ADDRESS_1, HARDHAT_0, HARDHAT_1 } from '../test/keys.js';
import { parseCodes } from './parse.js';

describe('parseCodes', () => {
  test('derives the checksummed address of a known key', () => {
    expect(parseCodes(HARDHAT_0.privateKey)).toEqual({
      codes: [{ line: 1, privateKey: HARDHAT_0.privateKey, address: HARDHAT_0.address }],
      errors: [],
    });
  });

  test("reads the dapp's bare-key export (frozen copy: one key per line, no trailing newline)", () => {
    const text = readFileSync(new URL('./fixtures/dapp-keys.txt', import.meta.url), 'utf8');
    expect(parseCodes(text).codes.map((c) => c.address)).toEqual([HARDHAT_0.address, HARDHAT_1.address, ADDRESS_1]);
  });

  test('accepts commas, tabs, spaces, CRLF, a BOM, upper case and a missing 0x', () => {
    const upper = HARDHAT_1.privateKey.slice(2).toUpperCase();
    const result = parseCodes(`﻿${HARDHAT_0.privateKey},\t${upper}\r\n`);
    expect(result.errors).toEqual([]);
    expect(result.codes.map((c) => c.privateKey)).toEqual([HARDHAT_0.privateKey, HARDHAT_1.privateKey]);
  });

  test('rejects keys outside the curve range and malformed hex, by line, without quoting them', () => {
    const zero = `0x${'0'.repeat(64)}`;
    const order = '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';
    const result = parseCodes([HARDHAT_0.privateKey, zero, '', order, '0x1234'].join('\n'));
    expect(result.errors).toEqual([
      { line: 2, reason: 'not a valid private key' },
      { line: 4, reason: 'not a valid private key' },
      { line: 5, reason: 'not a valid private key' },
    ]);
  });

  test('reports a duplicate against the line it first appeared on', () => {
    const result = parseCodes([HARDHAT_0.privateKey, HARDHAT_1.privateKey, HARDHAT_0.privateKey.toUpperCase().replace('0X', '0x')].join('\n'));
    expect(result.errors).toEqual([{ line: 3, reason: 'duplicate of line 1' }]);
  });

  test('names the item when a line holds several keys', () => {
    expect(parseCodes(`${HARDHAT_0.privateKey}, nope`).errors).toEqual([
      { line: 1, reason: 'not a valid private key (item 2)' },
    ]);
  });

  test("refuses the dapp's table export with a hint", () => {
    const table = `privateKey\taddress\tbatchId\n${HARDHAT_0.privateKey}\t${HARDHAT_0.address}\t`;
    expect(parseCodes(table)).toEqual({
      codes: [],
      errors: [{ line: 1, reason: "this is the dapp's table export (privateKey address batchId); export bare keys instead" }],
    });
  });
});
