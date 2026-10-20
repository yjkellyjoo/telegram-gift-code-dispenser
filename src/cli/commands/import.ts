import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseCodes, type LineError } from '../../codes/parse.js';
import { eventState } from '../../core/event-state.js';
import { hasAddress, insertCodes } from '../../store/codes.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError } from '../errors.js';
import { requireEvent } from './event.js';

export async function importCodes(env: CommandEnv): Promise<void> {
  const { values, positionals } = cliArgs(() =>
    parseArgs({ args: env.argv, options: { yes: { type: 'boolean' } }, allowPositionals: true, strict: true }),
  );
  const source = positionals[0];
  if (source === undefined || positionals.length > 1) throw new CliError('usage: dispenser import <file|-> [--yes]');
  const event = requireEvent(env);
  const state = eventState(event, env.deps.clock.now());
  if (state === 'closed' || state === 'wiped') throw new CliError('the event has closed; import refused');

  const text = source === '-' ? await env.stdin() : await readSource(source);
  const { codes, errors } = parseCodes(text);
  const db = env.db();
  const known: LineError[] = codes
    .filter((code) => hasAddress(db, event.id, code.address))
    .map((code) => ({ line: code.line, reason: 'this key is already in the database' }));
  const problems = [...errors, ...known].sort((a, b) => a.line - b.line);
  if (problems.length > 0) {
    for (const problem of problems) env.err(`line ${problem.line}: ${problem.reason}`);
    throw new CliError(`import aborted: ${problems.length} problem(s); nothing was imported`);
  }
  if (codes.length === 0) throw new CliError('no keys found in the input');

  if (values.yes !== true) {
    env.out(`parsed ${codes.length} keys; nothing imported (dry run). Run again with --yes to import.`);
    return;
  }
  insertCodes(db, event.id, codes);
  env.out(`imported ${codes.length} keys`);
}

async function readSource(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new CliError(`cannot read ${path}`);
  }
}
