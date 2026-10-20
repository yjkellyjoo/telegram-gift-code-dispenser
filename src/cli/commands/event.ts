import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { deliveryLength, MAX_MESSAGE_LENGTH } from '../../bot/messages.js';
import {
  generatePassphrase,
  hashPassphrase,
  MIN_PASSPHRASE_LENGTH,
  normalizePassphrase,
} from '../../core/passphrase.js';
import { getEvent, insertEvent, type EventRow } from '../../store/events.js';
import { formatDateTime, isTimeZone, parseLocalDateTime } from '../../time.js';
import type { CommandEnv, Terminal } from '../env.js';
import { cliArgs, CliError, intArg, required } from '../errors.js';
import { requireBotAdmin } from '../group.js';

const EVENT_OPTIONS = {
  title: { type: 'string' },
  group: { type: 'string' },
  opens: { type: 'string' },
  closes: { type: 'string' },
  tz: { type: 'string' },
  instructions: { type: 'string' },
  'max-attempts': { type: 'string' },
  'trip-rate': { type: 'string' },
} as const;

export function requireEvent(env: CommandEnv): EventRow {
  const event = getEvent(env.db());
  if (!event) throw new CliError('no event yet; create one with "dispenser event create"');
  return event;
}

function timeZone(tz: string): string {
  if (!isTimeZone(tz)) throw new CliError(`unknown time zone "${tz}"`);
  return tz;
}

function localTime(value: string, tz: string, flag: string): number {
  const at = parseLocalDateTime(value, tz);
  if (at === null) throw new CliError(`${flag} must look like "YYYY-MM-DD HH:mm", got "${value}"`);
  return at;
}

function groupId(value: string): number {
  return intArg(value, '--group', Number.MIN_SAFE_INTEGER, -1);
}

function tripRate(value: string): { tripCount: number; tripSeconds: number } {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const tripCount = Number(match?.[1]);
  const tripSeconds = Number(match?.[2]);
  if (!match || tripCount < 1 || tripSeconds < 10 || tripSeconds > 3600) {
    throw new CliError('--trip-rate must be <n>/<seconds>, with n at least 1 and seconds from 10 to 3600');
  }
  return { tripCount, tripSeconds };
}

async function readInstructions(path: string): Promise<string> {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    throw new CliError(`cannot read the instructions file ${path}`);
  }
}

function checkLength(title: string, instructions: string): void {
  const length = deliveryLength(title, instructions);
  if (length > MAX_MESSAGE_LENGTH) {
    throw new CliError(
      `the code message would be ${length} characters; Telegram allows ${MAX_MESSAGE_LENGTH}. Shorten the instructions.`,
    );
  }
}

async function askPassphrase(terminal: Terminal, generateFlag: string): Promise<string> {
  if (!terminal.isTTY) {
    throw new CliError(`the passphrase prompt needs a terminal: run it over "ssh -t", or use ${generateFlag}`);
  }
  const first = await terminal.ask('Passphrase: ', { hidden: true });
  const second = await terminal.ask('Repeat the passphrase: ', { hidden: true });
  if (first !== second) throw new CliError('the passphrases do not match');
  if (normalizePassphrase(first).length < MIN_PASSPHRASE_LENGTH) {
    throw new CliError(`the passphrase must have at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  return first;
}

export async function eventCreate(env: CommandEnv): Promise<void> {
  const { values } = cliArgs(() =>
    parseArgs({
      args: env.argv,
      options: { ...EVENT_OPTIONS, 'passphrase-generate': { type: 'boolean' } },
      strict: true,
    }),
  );
  const db = env.db();
  if (getEvent(db)) throw new CliError('an event already exists; this version holds one event per database');

  const now = env.deps.clock.now();
  const title = required(values.title, '--title');
  const tz = timeZone(values.tz ?? env.deps.defaultTz);
  const opensAt = localTime(required(values.opens, '--opens'), tz, '--opens');
  const closesAt = localTime(required(values.closes, '--closes'), tz, '--closes');
  if (opensAt >= closesAt) throw new CliError('--opens must be before --closes');
  if (closesAt <= now) throw new CliError('--closes must be in the future');
  const instructions = await readInstructions(required(values.instructions, '--instructions'));
  checkLength(title, instructions);
  const maxAttempts = values['max-attempts'] ? intArg(values['max-attempts'], '--max-attempts', 1, 100) : 5;
  const trip = values['trip-rate'] ? tripRate(values['trip-rate']) : { tripCount: 5, tripSeconds: 60 };
  const groupChatId = groupId(required(values.group, '--group'));
  const groupTitle = await requireBotAdmin(env.api(), groupChatId);

  const generated = values['passphrase-generate'] === true;
  const passphrase = generated ? generatePassphrase(env.deps.randomInt) : await askPassphrase(env.deps.terminal, '--passphrase-generate');
  insertEvent(db, {
    title,
    tz,
    opensAt,
    closesAt,
    groupChatId,
    passphraseHash: await hashPassphrase(passphrase),
    maxAttempts,
    instructions,
    ...trip,
  });
  env.out(`created "${title}" for group ${groupChatId} “${groupTitle}”`);
  env.out(`open from ${formatDateTime(opensAt, tz)} to ${formatDateTime(closesAt, tz)}`);
  if (generated) env.out(`passphrase: ${passphrase}`);
}
