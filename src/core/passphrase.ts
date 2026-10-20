import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { WORDLIST } from './wordlist.js';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

/** Longer text counts as a wrong try without being hashed. */
export const MAX_ATTEMPT_LENGTH = 200;
export const MIN_PASSPHRASE_LENGTH = 8;

function derive(passphrase: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export function normalizePassphrase(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(normalizePassphrase(passphrase), salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassphrase(attempt: string, encoded: string): Promise<boolean> {
  if (attempt.length > MAX_ATTEMPT_LENGTH) return false;
  const [scheme, n, r, p, salt, hash] = encoded.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) throw new Error('malformed passphrase hash');
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(normalizePassphrase(attempt), Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Three words from the EFF short word list: about 31 bits. */
export function generatePassphrase(randomInt: (max: number) => number): string {
  return Array.from({ length: 3 }, () => {
    const word = WORDLIST[randomInt(WORDLIST.length)];
    if (word === undefined) throw new RangeError('randomInt returned an index outside the word list');
    return word;
  }).join(' ');
}
