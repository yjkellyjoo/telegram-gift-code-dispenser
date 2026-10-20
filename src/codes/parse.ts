import { computeAddress } from 'ethers';

export interface ParsedCode {
  line: number;
  privateKey: string;
  address: string;
}

/** A problem on one input line. The reason never quotes the line's content. */
export interface LineError {
  line: number;
  reason: string;
}

export interface ParseResult {
  codes: ParsedCode[];
  errors: LineError[];
}

const HEX_KEY = /^(?:0[xX])?([0-9a-fA-F]{64})$/;
const TABLE_HEADER = 'privatekey address batchid';

/** Parses the dapp's bare-key export: keys separated by newlines, commas, tabs, or spaces. */
export function parseCodes(text: string): ParseResult {
  const codes: ParsedCode[] = [];
  const errors: LineError[] = [];
  const firstSeen = new Map<string, number>();
  let sawContent = false;

  for (const [index, raw] of text.replace(/^﻿/, '').split(/\r?\n/).entries()) {
    const line = index + 1;
    const tokens = raw.split(/[,\t ]+/).filter((t) => t.length > 0);
    if (tokens.length === 0) continue;
    if (!sawContent && tokens.join(' ').toLowerCase() === TABLE_HEADER) {
      return {
        codes: [],
        errors: [{ line, reason: "this is the dapp's table export (privateKey address batchId); export bare keys instead" }],
      };
    }
    sawContent = true;

    for (const [position, token] of tokens.entries()) {
      const where = tokens.length > 1 ? ` (item ${position + 1})` : '';
      const hex = HEX_KEY.exec(token)?.[1];
      const privateKey = hex === undefined ? null : `0x${hex.toLowerCase()}`;
      const address = privateKey === null ? null : addressOf(privateKey);
      if (privateKey === null || address === null) {
        errors.push({ line, reason: `not a valid private key${where}` });
        continue;
      }
      const seen = firstSeen.get(privateKey);
      if (seen !== undefined) {
        errors.push({ line, reason: `duplicate of line ${seen}${where}` });
        continue;
      }
      firstSeen.set(privateKey, line);
      codes.push({ line, privateKey, address });
    }
  }
  return { codes, errors };
}

/** The checksummed address, or null when the key is outside secp256k1's range (0 or ≥ n). */
function addressOf(privateKey: string): string | null {
  try {
    return computeAddress(privateKey);
  } catch {
    return null;
  }
}
