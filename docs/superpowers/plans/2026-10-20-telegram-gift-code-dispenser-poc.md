# Telegram Gift Code Dispenser PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PoC dispenser from the spec: a Telegram bot that gives one gift code to each verified account at one in-person event, a CLI that runs the event, and the KPI tooling.

**Architecture:** One TypeScript package with two entry points in one Docker image: the grammY bot (long polling) and the `dispenser` CLI.
Both share one SQLite database through `src/store`.
Domain rules live in `src/core`; `src/bot` and `src/cli` are thin adapters around them.
Tests drive the code only through three seams (the bot's `handleUpdate`, the CLI's `runCli`, and `parseCodes`) and fake only Telegram, Blockscout, the clock, randomness and the terminal.

**Tech Stack:** Node.js 24 LTS in the image (22.12 or later for development), TypeScript 6.0, grammY 1.46 with its runner and auto-retry plugins, better-sqlite3 13, ethers 6.17, Vitest 5, ESLint 10 with typescript-eslint, pnpm 11, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-19-telegram-gift-code-dispenser-design.md` (as of commit `a0babfb`).

## How this plan was checked

Every code block in this plan was run before the plan was written, in a throwaway copy of the repository.
Replaying the tasks in order, each task's new tests failed on the previous task's code and passed after it, and `tsc` and ESLint were clean at every step.
The final image was built and run on arm64 as a non-root, read-only container, and the CLI wrapper was exercised through `docker compose run`.
So copy the code as written.
If a command's output differs from what a step says, stop and report it instead of improvising a fix.

## Global Constraints

- Node.js 22.12 or later for development; the image uses `node:24-bookworm-slim`.
- pnpm 11.24.0, with every dependency pinned exactly in `package.json` (Task 1); no other runtime dependency may be added.
- Every pinned version was published at least two weeks before 2026-10-20; pnpm 11's minimum-release-age check rejects very new versions.
- better-sqlite3's build script stays off (`allowBuilds: better-sqlite3: false`): it ships prebuilt binaries, linux-arm64 included, and loads them first.
- ESM throughout (`"type": "module"`, `module: nodenext`); relative imports end in `.js`.
- SQLite pragmas: `journal_mode=WAL`, `synchronous=FULL`, `secure_delete=ON`, `foreign_keys=ON`, `busy_timeout=5000`; all times are stored as UTC milliseconds.
- Spec defaults: 5 tries per account; a breaker limit of 5 claims per 60 seconds (`--trip-rate` takes n ≥ 1 and 10–3600 seconds); 3 updates per 2 seconds per account; text over 200 characters is a wrong try; passphrases have at least 8 characters after normalization.
- Passphrases are normalized with NFKC, trimmed, whitespace collapsed and lowercased; hashed with scrypt (N = 16384, r = 8, p = 1, 16-byte salt); generated ones are 3 words from the EFF short word list.
- The KPI window is 30 days after `claimed_at`; the PostageStamp contract is `0x45a1502382541Cd610CC9068e88727426b696293`; the Blockscout default is `https://gnosisscan.io`.
- Group chat IDs are negative, so the CLI takes them as `--group=<id>`.
- No log line may contain a key, a passphrase attempt, the bot token, or message text; log fields take primitives only.
- Only `src/cli` may import `src/store/bulk.ts`; ESLint enforces it.
- Claimant-facing text is exactly as written in `src/bot/messages.ts` (Task 5) and `src/core/checkin.ts` (Task 16), which follow spec §8.2, §8.6, §9 and §10.3.
- Tests go only through the three seams; fakes sit only at Telegram's transport, Blockscout's `fetch`, the clock, randomness and the terminal.
- Markdown prose: one sentence per line.
- Commits: Conventional Commits, `git commit -s`, files added by explicit path, never `--no-verify`; end each message with the attribution trailers your session's instructions give.

## Review Focus

These inputs are likely in real use and the spec's own test list does not cover them, so each one has a test in the task that owns the code:

1. HTML characters in the event title or instructions (`<3`, `&`, URLs with query strings) are escaped, so Telegram accepts the code message (Task 5).
2. Passphrases typed on phones, with non-breaking spaces, em spaces or full-width letters, still match after NFKC normalization (Task 5).
3. New Telegram accounts have 10-digit IDs; the lockout, its reply and `unlock` work for them (Task 8).
4. A summer event (CEST, UTC+2) opens at the right instant, not an hour off (Task 9).
5. When the group was upgraded to a supergroup after setup, `status` names Telegram's reason, so the admin knows to switch with `event edit --group=` (Task 11).

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `src/codes/parse.ts` | `parseCodes`: the dapp's bare-key export to keys and addresses, or line errors | 1 |
| `src/clock.ts`, `src/log.ts` | Injected time; a JSON-lines logger that scrubs secrets | 2 |
| `src/store/schema.ts`, `src/store/db.ts` | The schema; creating and opening the database | 2 |
| `src/store/events.ts` | The single event row | 2 |
| `src/store/codes.ts` | Codes, claims and check-in columns | 4, grows later |
| `src/store/attempts.ts` | Passphrase tries and lockouts | 5, grows later |
| `src/store/bulk.ts` | Reading every unclaimed key, and wiping; CLI only | 14 |
| `src/time.ts` | Parsing and formatting wall-clock times in a time zone | 3 |
| `src/core/` | Rules: event state, passphrases, `claimOrGet`, membership, check-in | 3, grows later |
| `src/chain/` | The Blockscout client and the KPI milestones | 15 |
| `src/bot/` | grammY wiring, the claim flow, replies, group status, check-in taps | 5, grows later |
| `src/cli/` | `runCli`, every command, the group check, the real terminal | 2, grows later |
| `src/config.ts`, `src/main.ts` | Reading `bot.env`; the `bot` and `dispenser` entry points | 18 |
| `src/test/` | Fakes and the test harness | 1, grows later |
| `Dockerfile`, `deploy/` | The image, the Compose file and the CLI wrapper for the Pi | 18 |

Run every command from the repository root.

---

### Task 1: Project setup and the import parser

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `.github/workflows/check.yml`
- Create: `src/codes/parse.ts`
- Create: `src/test/keys.ts`, `src/codes/fixtures/dapp-keys.txt`
- Test: `src/codes/parse.test.ts`

**Interfaces:**
- Produces: `parseCodes(text: string): ParseResult`, where `ParseResult = { codes: ParsedCode[]; errors: LineError[] }`, `ParsedCode = { line: number; privateKey: string; address: string }` and `LineError = { line: number; reason: string }`.
- Produces (tests): `key(n)`, `ADDRESS_1` to `ADDRESS_3`, `HARDHAT_0` and `HARDHAT_1` in `src/test/keys.ts`.

- [ ] **Step 1: Branch off the docs branch**

The spec and this plan live on `docs/dispenser-design`; `main` has no commits yet.

```bash
git switch docs/dispenser-design
git switch -c feat/poc-dispenser
```

- [ ] **Step 2: Write the project files**

`package.json`:

```json
{
  "name": "telegram-gift-code-dispenser",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.24.0",
  "engines": {
    "node": ">=22.12"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "check": "pnpm typecheck && pnpm lint && pnpm test"
  },
  "dependencies": {
    "@grammyjs/auto-retry": "2.0.2",
    "@grammyjs/runner": "2.0.3",
    "better-sqlite3": "13.0.3",
    "ethers": "6.17.0",
    "grammy": "1.46.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "9.6.0",
    "@types/node": "24.19.1",
    "eslint": "10.12.0",
    "typescript": "6.0.3",
    "typescript-eslint": "8.71.1",
    "vitest": "5.0.3"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
# better-sqlite3 ships prebuilt binaries (linux-arm64 included) and loads them first,
# so its node-gyp build script stays off: no compiler in the image.
allowBuilds:
  better-sqlite3: false
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

`tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/test"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

`eslint.config.js`:

```js
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**'] },
  tseslint.configs.recommended,
  {
    files: ['src/bot/**/*.ts', 'src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/store/bulk', '**/store/bulk.js'],
          message: 'store/bulk reads every key at once; only src/cli may import it.',
        }],
      }],
    },
  },
);
```

`.gitignore`:

```text
node_modules/
dist/
coverage/
*.db
*.db-wal
*.db-shm
```

`.github/workflows/check.yml`:

```yaml
name: check
on:
  push:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
```

- [ ] **Step 3: Install**

```bash
pnpm --version   # must print 11.24.0; otherwise run: npm install --global pnpm@11.24.0
pnpm install
```

Expected: pnpm creates `pnpm-lock.yaml` and ends with `Done`, with no `ERR_PNPM` line.

- [ ] **Step 4: Write the failing test**

`src/test/keys.ts` (expected values derived independently of the code under test):

```ts
/** Private key n as 32-byte hex: 0x…01, 0x…02, … Valid secp256k1 keys with well-known addresses. */
export const key = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;

/** Addresses of key(1), key(2), key(3), derived independently of the code under test. */
export const ADDRESS_1 = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
export const ADDRESS_2 = '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF';
export const ADDRESS_3 = '0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69';

/** Hardhat's well-known accounts #0 and #1. */
export const HARDHAT_0 = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
};
export const HARDHAT_1 = {
  privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
};
```

The fixture is a frozen copy of the dapp's bare-key export (`buildKeyList`: keys joined by newlines, no trailing newline):

```bash
mkdir -p src/codes/fixtures
printf '%s\n%s\n%s' \
  0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  0x0000000000000000000000000000000000000000000000000000000000000001 \
  > src/codes/fixtures/dapp-keys.txt
```

`src/codes/parse.test.ts`:

```ts
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
```

- [ ] **Step 5: Run it to see it fail**

Run: `pnpm vitest run src/codes`
Expected: FAIL with `Error: Cannot find module './parse.js'`.

- [ ] **Step 6: Implement the parser**

`src/codes/parse.ts`:

```ts
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
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run src/codes`
Expected: `Tests  7 passed (7)`.

- [ ] **Step 8: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  7 passed (7)`.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json vitest.config.ts eslint.config.js .gitignore .github/workflows/check.yml src/test/keys.ts src/codes/fixtures/dapp-keys.txt src/codes/parse.ts src/codes/parse.test.ts
git commit -s -m "feat(codes): parse the dapp's bare-key export" -m "- set up typescript, vitest, eslint and pnpm with pinned versions
- parse bare keys into checksummed addresses, with line errors that never quote a key"
```

---

### Task 2: Database, logger and `dispenser init`

**Files:**
- Create: `src/clock.ts`, `src/log.ts`, `src/store/schema.ts`, `src/store/db.ts`, `src/store/events.ts`
- Create: `src/cli/errors.ts`, `src/cli/env.ts`, `src/cli/run-cli.ts`, `src/cli/commands/init.ts`, `src/cli/commands/status.ts`
- Create (tests): `src/test/fake-clock.ts`, `src/test/telegram-fake.ts`, `src/test/harness.ts`
- Test: `src/cli/init.test.ts`

**Interfaces:**
- Produces: `createDatabase(dataDir): Db` (refuses an existing file), `openDatabase(dataDir): Db` (refuses a missing file or a wrong schema version), `databasePath(dataDir)`, `DatabaseError`, `type Db`.
- Produces: `getEvent(db): EventRow | undefined`, `insertEvent(db, event: NewEvent): void`, `updateEvent(db, id, patch: EventPatch): void`, and the types `EventRow`, `NewEvent`, `EventPatch`, `PausedReason`.
- Produces: `runCli(argv: string[], stdin: () => Promise<string>, deps: CliDeps): Promise<CliResult>`, with `CliResult = { code: number; stdout: string; stderr: string }`.
- Produces: `CommandEnv` (`argv`, `deps`, `out`, `err`, `stdin`, `db()`, `api()`), `type Command`, `Terminal`, `CliDeps`; `CliError`, `cliArgs(parse)`, `required(value, flag)`, `intArg(value, flag, min, max)`.
- Produces: `Clock`, `systemClock`, `createLogger(write, secrets, clock): Logger`, `errorFields(err): LogFields`.
- Produces (tests): `Harness` with `cli(argv, { stdin, tty, answers })`, `ok(argv)`, `close()` and the constants `TOKEN`, `BOT_ID`, `ADMIN_ID`, `GROUP_ID`, `PASSPHRASE`, `INSTRUCTIONS`; `TelegramFake` with `setStatus`, `failNext`, `textsTo`, `sent`, `callbackAnswers`, `leftChats`, `transformer`, `chatMember(status, user)`; `FakeClock` with `set(iso)` and `advance(ms)`.

- [ ] **Step 1: Write the test utilities and the failing test**

`src/test/fake-clock.ts`:

```ts
import type { Clock } from '../clock.js';

export class FakeClock implements Clock {
  constructor(private ms: number) {}

  now(): number {
    return this.ms;
  }

  set(iso: string): void {
    this.ms = Date.parse(iso);
  }

  advance(ms: number): void {
    this.ms += ms;
  }
}
```

`src/test/telegram-fake.ts` stands in for the Bot API at grammY's transport; its objects are typed by grammY, so no required field can be missing:

```ts
import type { Transformer } from 'grammy';
import type { ChatFullInfo, ChatMember, Message, User, UserFromGetMe } from 'grammy/types';

export type MemberStatus = ChatMember['status'];
export type Failure = { error_code: number; description: string } | Error;

export interface Sent {
  chatId: number;
  text: string;
  parseMode: string | undefined;
  replyMarkup: unknown;
}

/** Complete, real-shaped ChatMember objects, typed by grammY so no required field is missing. */
export function chatMember(status: MemberStatus, user: User): ChatMember {
  switch (status) {
    case 'creator':
      return { status, user, is_anonymous: false };
    case 'administrator':
      return {
        status, user, can_be_edited: false, is_anonymous: false, can_manage_chat: true,
        can_delete_messages: false, can_manage_video_chats: false, can_restrict_members: false,
        can_promote_members: false, can_change_info: false, can_invite_users: false,
        can_post_stories: false, can_edit_stories: false, can_delete_stories: false,
        can_send_welcome_messages: false,
      };
    case 'member':
      return { status, user };
    case 'restricted':
      return {
        status, user, is_member: true, can_send_messages: false, can_send_audios: false,
        can_send_documents: false, can_send_photos: false, can_send_videos: false,
        can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
        can_send_other_messages: false, can_add_web_page_previews: false, can_react_to_messages: false,
        can_change_info: false, can_invite_users: false, can_edit_tag: false, can_pin_messages: false,
        can_manage_topics: false, until_date: 0,
      };
    case 'left':
      return { status, user };
    case 'kicked':
      return { status, user, until_date: 0 };
  }
}

/**
 * Stands in for the Bot API at grammY's transport. Records what users would see and
 * answers the methods the dispenser calls. Unknown methods throw, so nothing goes unnoticed.
 */
export class TelegramFake {
  readonly botInfo: UserFromGetMe;
  readonly sent: Sent[] = [];
  readonly callbackAnswers: Array<{ id: string; text: string | undefined }> = [];
  readonly leftChats: number[] = [];
  groupTitle = 'Swarm booth chat';
  private readonly statuses = new Map<string, MemberStatus>();
  private readonly failures = new Map<string, Failure[]>();

  constructor(botId: number, groupId: number) {
    this.botInfo = {
      id: botId, is_bot: true, first_name: 'Gift Dispenser', username: 'gift_dispenser_test_bot',
      can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
      allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false,
    };
    this.setStatus(groupId, botId, 'administrator');
  }

  /** Users default to `member` everywhere; set anything else here. */
  setStatus(chatId: number, userId: number, status: MemberStatus): void {
    this.statuses.set(`${chatId}:${userId}`, status);
  }

  /** The next call to `method` fails: with a Telegram error, or by throwing (a network failure). */
  failNext(method: string, failure: Failure): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), failure]);
  }

  textsTo(chatId: number): string[] {
    return this.sent.filter((s) => s.chatId === chatId).map((s) => s.text);
  }

  readonly transformer: Transformer = async (_prev, method, payload) => {
    const failure = this.failures.get(method)?.shift();
    if (failure instanceof Error) throw failure;
    if (failure) return { ok: false, ...failure };
    return { ok: true, result: this.answer(method, payload as Record<string, unknown>) as never };
  };

  private answer(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'getMe':
        return this.botInfo;
      case 'getChat':
        return {
          id: Number(p.chat_id), type: 'supergroup', title: this.groupTitle, accent_color_id: 0,
          max_reaction_count: 11,
          accepted_gift_types: {
            unlimited_gifts: false, limited_gifts: false, unique_gifts: false,
            premium_subscription: false, gifts_from_channels: false,
          },
        } satisfies ChatFullInfo.SupergroupChat;
      case 'getChatMember': {
        const userId = Number(p.user_id);
        const status = this.statuses.get(`${Number(p.chat_id)}:${userId}`) ?? 'member';
        return chatMember(status, { id: userId, is_bot: userId === this.botInfo.id, first_name: `User${userId}` });
      }
      case 'sendMessage': {
        const chatId = Number(p.chat_id);
        const text = String(p.text);
        this.sent.push({ chatId, text, parseMode: p.parse_mode as string | undefined, replyMarkup: p.reply_markup });
        return {
          message_id: this.sent.length, date: 1_794_650_400,
          chat: { id: chatId, type: 'private', first_name: `User${chatId}` }, text,
        } satisfies Message.TextMessage;
      }
      case 'answerCallbackQuery':
        this.callbackAnswers.push({ id: String(p.callback_query_id), text: p.text as string | undefined });
        return true;
      case 'leaveChat':
        this.leftChats.push(Number(p.chat_id));
        return true;
      default:
        throw new Error(`TelegramFake does not implement ${method}`);
    }
  }
}
```

`src/test/harness.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, type CliResult } from '../cli/run-cli.js';
import { createLogger, type Logger } from '../log.js';
import { FakeClock } from './fake-clock.js';
import { TelegramFake } from './telegram-fake.js';

export const TOKEN = '777000:AAH-test-token-secret-value';
export const BOT_ID = 777000;
export const ADMIN_ID = 1000;
export const GROUP_ID = -1001234567890;
export const PASSPHRASE = 'Orbit Maple Lantern';
export const INSTRUCTIONS = 'Import the key into your Bee node: https://docs.ethswarm.org';

export interface CliOptions {
  stdin?: string;
  tty?: boolean;
  answers?: string[];
}

/** One temp data directory with a fake clock, a fake Telegram and captured logs, driven through the seams. */
export class Harness {
  readonly dir = mkdtempSync(join(tmpdir(), 'dispenser-'));
  readonly dataDir = this.dir;
  readonly instructionsFile = join(this.dir, 'instructions.txt');
  readonly clock = new FakeClock(Date.parse('2026-11-14T09:00:00Z'));
  readonly telegram = new TelegramFake(BOT_ID, GROUP_ID);
  readonly logs: string[] = [];
  readonly log: Logger = createLogger((line) => this.logs.push(line), [TOKEN], this.clock);
  /** Consumed by randomInt in order; 0 once empty. */
  randomInts: number[] = [];
  fetch: typeof fetch = async () => {
    throw new Error('unexpected fetch');
  };
  readonly sleeps: number[] = [];

  constructor() {
    writeFileSync(this.instructionsFile, INSTRUCTIONS);
  }

  cli(argv: string[], options: CliOptions = {}): Promise<CliResult> {
    const answers = [...(options.answers ?? [])];
    return runCli(argv, async () => options.stdin ?? '', {
      dataDir: this.dataDir,
      token: TOKEN,
      defaultTz: 'UTC',
      clock: this.clock,
      log: this.log,
      terminal: { isTTY: options.tty ?? false, ask: async () => answers.shift() ?? '' },
      randomInt: (max) => {
        const n = this.randomInts.shift() ?? 0;
        if (n >= max) throw new RangeError(`randomInt(${max}) cannot return ${n}`);
        return n;
      },
      transformers: [this.telegram.transformer],
      fetch: (input, init) => this.fetch(input, init),
      blockscoutUrl: 'https://blockscout.test',
      sleep: async (ms) => {
        this.sleeps.push(ms);
      },
    });
  }

  /** Runs a CLI command that must succeed, for test setup. */
  async ok(argv: string[], options: CliOptions = {}): Promise<CliResult> {
    const result = await this.cli(argv, options);
    if (result.code !== 0) throw new Error(`dispenser ${argv.join(' ')} failed:\n${result.stderr}`);
    return result;
  }

  close(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
```

`src/cli/init.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness } from '../test/harness.js';

let h: Harness;
beforeEach(() => {
  h = new Harness();
});
afterEach(() => h.close());

describe('dispenser init', () => {
  test('creates the database, after which status works', async () => {
    expect((await h.cli(['init'])).code).toBe(0);
    expect((await h.cli(['status'])).stdout).toBe('No event yet. Create one with "dispenser event create".\n');
  });

  test('refuses to run twice, so a live event can never be reset', async () => {
    await h.ok(['init']);
    const again = await h.cli(['init']);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/^error: a database already exists at /);
  });

  test('every other command refuses without a database', async () => {
    const result = await h.cli(['status']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/run "dispenser init" first/);
  });

  test('an unknown command prints the usage with exit code 2', async () => {
    const result = await h.cli(['frobnicate']);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/^usage: dispenser <command>/);
  });

  test('an unknown flag is an error, not ignored', async () => {
    const result = await h.cli(['init', '--force']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^error: .*--force/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/cli/init.test.ts`
Expected: FAIL with `Error: Cannot find module '../cli/run-cli.js'`.

- [ ] **Step 3: Write the clock and the logger**

`src/clock.ts`:

```ts
/** Milliseconds since the Unix epoch (UTC). Injected so tests control time. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
```

`src/log.ts`:

```ts
import { GrammyError } from 'grammy';
import type { Clock } from './clock.js';

/** Only primitives, so an update, a payload or an error object can never be logged whole. */
export type LogFields = Record<string, string | number | boolean | null>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** JSON-lines logger that scrubs every secret by value. */
export function createLogger(write: (line: string) => void, secrets: readonly string[], clock: Clock): Logger {
  const scrub = (line: string): string =>
    secrets.filter((s) => s.length > 0).reduce((out, s) => out.split(s).join('[redacted]'), line);
  const emit = (level: 'info' | 'warn' | 'error') => (msg: string, fields: LogFields = {}) =>
    write(scrub(JSON.stringify({ time: new Date(clock.now()).toISOString(), level, msg, ...fields })));
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/** What may be logged about an error: its kind and Telegram's error code, never its payload. */
export function errorFields(err: unknown): LogFields {
  if (err instanceof GrammyError) return { error: 'GrammyError', errorCode: err.error_code, method: err.method };
  if (err instanceof Error) return { error: err.name };
  return { error: typeof err };
}
```

- [ ] **Step 4: Write the schema and the database access**

`src/store/schema.ts`:

```ts
/** Migrations, numbered by position: MIGRATIONS[0] is version 1. Never edit one that has shipped. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE events (
    id              INTEGER PRIMARY KEY,
    title           TEXT    NOT NULL,
    tz              TEXT    NOT NULL,
    opens_at        INTEGER NOT NULL,
    closes_at       INTEGER NOT NULL,
    closed_at       INTEGER,
    group_chat_id   INTEGER NOT NULL,
    passphrase_hash TEXT,
    max_attempts    INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
    instructions    TEXT    NOT NULL,
    trip_count      INTEGER NOT NULL DEFAULT 5 CHECK (trip_count >= 1),
    trip_seconds    INTEGER NOT NULL DEFAULT 60 CHECK (trip_seconds BETWEEN 10 AND 3600),
    paused_at       INTEGER,
    paused_reason   TEXT CHECK (paused_reason IN ('burst', 'manual')),
    resumed_at      INTEGER,
    exported_at     INTEGER,
    wiped_at        INTEGER,
    CHECK (opens_at < closes_at),
    CHECK (passphrase_hash IS NOT NULL OR wiped_at IS NOT NULL)
  );

  CREATE TABLE codes (
    id                  INTEGER PRIMARY KEY,
    event_id            INTEGER NOT NULL REFERENCES events (id),
    private_key         TEXT,
    address             TEXT    NOT NULL,
    claimed_by          INTEGER,
    claimed_at          INTEGER,
    checkin_status      TEXT CHECK (checkin_status IN ('sent', 'unreachable', 'failed')),
    checkin_sent_at     INTEGER,
    checkin_answer      TEXT CHECK (checkin_answer IN
                          ('uploaded', 'not_yet', 'stuck_install', 'stuck_import', 'stuck_upload', 'stuck_other')),
    checkin_answered_at INTEGER,
    UNIQUE (event_id, claimed_by),
    UNIQUE (event_id, address),
    CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))
  );

  CREATE TABLE attempts (
    event_id         INTEGER NOT NULL REFERENCES events (id),
    telegram_user_id INTEGER NOT NULL,
    failures         INTEGER NOT NULL DEFAULT 0,
    locked_at        INTEGER,
    PRIMARY KEY (event_id, telegram_user_id)
  );
  `,
];
```

`src/store/db.ts`:

```ts
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS } from './schema.js';

export type Db = Database.Database;

export class DatabaseError extends Error {
  override name = 'DatabaseError';
}

export function databasePath(dataDir: string): string {
  return join(dataDir, 'dispenser.db');
}

function applyPragmas(db: Db): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('secure_delete = ON');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

/** Creates a new database. Refuses when one exists, so `init` can never reset a live event. */
export function createDatabase(dataDir: string): Db {
  const path = databasePath(dataDir);
  if (existsSync(path)) throw new DatabaseError(`a database already exists at ${path}`);
  const db = new Database(path);
  applyPragmas(db);
  db.transaction(() => {
    for (const sql of MIGRATIONS) db.exec(sql);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(MIGRATIONS.length));
  })();
  return db;
}

/** Opens the existing database. Refuses when it is missing, so a mis-mounted volume fails loudly. */
export function openDatabase(dataDir: string): Db {
  const path = databasePath(dataDir);
  if (!existsSync(path)) throw new DatabaseError(`no database at ${path}; run "dispenser init" first`);
  const db = new Database(path, { fileMustExist: true });
  applyPragmas(db);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  if (row?.value !== String(MIGRATIONS.length)) {
    db.close();
    throw new DatabaseError(`unexpected schema version ${row?.value ?? 'none'}; this build expects ${MIGRATIONS.length}`);
  }
  return db;
}
```

`src/store/events.ts`:

```ts
import type { Db } from './db.js';

export type PausedReason = 'burst' | 'manual';

export interface EventRow {
  id: number;
  title: string;
  tz: string;
  opensAt: number;
  closesAt: number;
  closedAt: number | null;
  groupChatId: number;
  passphraseHash: string | null;
  maxAttempts: number;
  instructions: string;
  tripCount: number;
  tripSeconds: number;
  pausedAt: number | null;
  pausedReason: PausedReason | null;
  resumedAt: number | null;
  exportedAt: number | null;
  wipedAt: number | null;
}

export type NewEvent = Pick<
  EventRow,
  'title' | 'tz' | 'opensAt' | 'closesAt' | 'groupChatId' | 'maxAttempts' | 'instructions' | 'tripCount' | 'tripSeconds'
> & { passphraseHash: string };

export type EventPatch = Partial<Omit<EventRow, 'id'>>;

const COLUMN: Record<keyof EventPatch, string> = {
  title: 'title',
  tz: 'tz',
  opensAt: 'opens_at',
  closesAt: 'closes_at',
  closedAt: 'closed_at',
  groupChatId: 'group_chat_id',
  passphraseHash: 'passphrase_hash',
  maxAttempts: 'max_attempts',
  instructions: 'instructions',
  tripCount: 'trip_count',
  tripSeconds: 'trip_seconds',
  pausedAt: 'paused_at',
  pausedReason: 'paused_reason',
  resumedAt: 'resumed_at',
  exportedAt: 'exported_at',
  wipedAt: 'wiped_at',
};

const SELECT = `SELECT id, ${Object.entries(COLUMN)
  .map(([field, column]) => `${column} AS ${field}`)
  .join(', ')} FROM events`;

/** The database holds at most one event. */
export function getEvent(db: Db): EventRow | undefined {
  return db.prepare(`${SELECT} ORDER BY id LIMIT 1`).get() as EventRow | undefined;
}

export function insertEvent(db: Db, event: NewEvent): void {
  db.prepare(
    `INSERT INTO events (title, tz, opens_at, closes_at, group_chat_id, passphrase_hash,
       max_attempts, instructions, trip_count, trip_seconds)
     VALUES (@title, @tz, @opensAt, @closesAt, @groupChatId, @passphraseHash,
       @maxAttempts, @instructions, @tripCount, @tripSeconds)`,
  ).run(event);
}

export function updateEvent(db: Db, id: number, patch: EventPatch): void {
  const fields = (Object.keys(patch) as Array<keyof EventPatch>).filter((f) => patch[f] !== undefined);
  if (fields.length === 0) return;
  const sets = fields.map((f) => `${COLUMN[f]} = @${f}`).join(', ');
  db.prepare(`UPDATE events SET ${sets} WHERE id = @id`).run({ ...patch, id });
}
```

- [ ] **Step 5: Write the CLI**

`src/cli/errors.ts`:

```ts
/** An expected failure: printed as "error: <message>" with exit code 1. */
export class CliError extends Error {
  override name = 'CliError';
}

/** Runs node:util parseArgs and turns its errors into CliErrors. */
export function cliArgs<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    throw new CliError(err instanceof Error ? err.message : String(err));
  }
}

export function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === '') throw new CliError(`${flag} is required`);
  return value;
}

export function intArg(value: string, flag: string, min: number, max: number): number {
  const n = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new CliError(`${flag} must be a whole number from ${min} to ${max}`);
  }
  return n;
}
```

`src/cli/env.ts`:

```ts
import type { Api, Transformer } from 'grammy';
import type { Clock } from '../clock.js';
import type { Logger } from '../log.js';
import type { Db } from '../store/db.js';

export interface Terminal {
  isTTY: boolean;
  ask(question: string, options: { hidden: boolean }): Promise<string>;
}

export interface CliDeps {
  dataDir: string;
  token: string;
  defaultTz: string;
  clock: Clock;
  log: Logger;
  terminal: Terminal;
  randomInt: (max: number) => number;
  transformers?: Transformer[];
  fetch: typeof fetch;
  blockscoutUrl: string;
  sleep: (ms: number) => Promise<void>;
}

export interface CommandEnv {
  /** Arguments after the command words. */
  argv: string[];
  deps: CliDeps;
  out(line: string): void;
  err(line: string): void;
  stdin(): Promise<string>;
  /** Opens the database on first use; runCli closes it. */
  db(): Db;
  api(): Api;
}

export type Command = (env: CommandEnv) => Promise<void> | void;
```

`src/cli/run-cli.ts` (the usage text lists every command; later tasks add each one to `COMMANDS`):

```ts
import { Api } from 'grammy';
import { errorFields } from '../log.js';
import { DatabaseError, openDatabase, type Db } from '../store/db.js';
import { init } from './commands/init.js';
import { status } from './commands/status.js';
import type { CliDeps, Command, CommandEnv } from './env.js';
import { CliError } from './errors.js';

export type { CliDeps, Terminal } from './env.js';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const COMMANDS: Record<string, Command> = {
  init,
  status,
};

const USAGE = `usage: dispenser <command>

  init                      create the database
  status                    event, claims, breaker, group, lockouts, recent claims
  event create --title <text> --group=<chat id> --opens "YYYY-MM-DD HH:mm"
               --closes "YYYY-MM-DD HH:mm" [--tz <zone>] --instructions <file>
               [--passphrase-generate] [--max-attempts <n>] [--trip-rate <n>/<seconds>]
  event edit <any create flag except the passphrase>
  event passphrase [--generate]
  event close
  import <file|-> [--yes]
  pause
  resume [--yes]
  unlock <telegram user id>
  export
  wipe --checksum <sum>
  checkin send
  stats`;

export async function runCli(argv: string[], stdin: () => Promise<string>, deps: CliDeps): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const twoWords = `${argv[0] ?? ''} ${argv[1] ?? ''}`;
  const [name, rest] = COMMANDS[twoWords] ? [twoWords, argv.slice(2)] : [argv[0] ?? '', argv.slice(1)];
  const command = COMMANDS[name];
  if (!command) return { code: 2, stdout: '', stderr: `${USAGE}\n` };

  let db: Db | undefined;
  let api: Api | undefined;
  const env: CommandEnv = {
    argv: rest,
    deps,
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    stdin,
    db: () => (db ??= openDatabase(deps.dataDir)),
    api: () => {
      if (!api) {
        api = new Api(deps.token);
        for (const transformer of deps.transformers ?? []) api.config.use(transformer);
      }
      return api;
    },
  };

  let code = 0;
  try {
    await command(env);
  } catch (err) {
    code = 1;
    if (err instanceof CliError || err instanceof DatabaseError) {
      stderr.push(`error: ${err.message}`);
    } else {
      deps.log.error('command failed', { command: name, ...errorFields(err) });
      stderr.push(`error: unexpected failure (${err instanceof Error ? err.name : typeof err}); see the log`);
    }
  } finally {
    db?.close();
  }
  const join = (lines: string[]) => (lines.length > 0 ? `${lines.join('\n')}\n` : '');
  return { code, stdout: join(stdout), stderr: join(stderr) };
}
```

`src/cli/commands/init.ts`:

```ts
import { parseArgs } from 'node:util';
import { createDatabase, databasePath } from '../../store/db.js';
import type { CommandEnv } from '../env.js';
import { cliArgs } from '../errors.js';

export function init(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  createDatabase(env.deps.dataDir).close();
  env.out(`created ${databasePath(env.deps.dataDir)}`);
}
```

`src/cli/commands/status.ts` (later tasks extend it):

```ts
import { parseArgs } from 'node:util';
import { getEvent } from '../../store/events.js';
import type { CommandEnv } from '../env.js';
import { cliArgs } from '../errors.js';

export function status(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = getEvent(env.db());
  if (!event) {
    env.out('No event yet. Create one with "dispenser event create".');
    return;
  }
  env.out(`Event     ${event.title}`);
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/cli/init.test.ts`
Expected: `Tests  5 passed (5)`.

- [ ] **Step 7: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  12 passed (12)`.

- [ ] **Step 8: Commit**

```bash
git add src/clock.ts src/log.ts src/store/schema.ts src/store/db.ts src/store/events.ts src/cli/errors.ts src/cli/env.ts src/cli/run-cli.ts src/cli/commands/init.ts src/cli/commands/status.ts src/test/fake-clock.ts src/test/telegram-fake.ts src/test/harness.ts src/cli/init.test.ts
git commit -s -m "feat(cli): create the database with dispenser init" -m "- add the schema, pragmas and schema-version check
- add runCli with usage, error handling and the init and status commands
- add the json-lines logger that scrubs the token
- add the telegram fake, fake clock and test harness"
```

---

### Task 3: `dispenser event create`

**Files:**
- Create: `src/time.ts`, `src/core/wordlist.ts` (generated), `src/core/passphrase.ts`, `src/core/event-state.ts`, `src/bot/messages.ts`, `src/cli/group.ts`, `src/cli/commands/event.ts`
- Modify: `src/cli/run-cli.ts`, `src/cli/commands/status.ts`, `src/test/harness.ts`
- Test: `src/cli/event.test.ts`

**Interfaces:**
- Consumes: `getEvent`, `insertEvent` (Task 2), `CommandEnv`, `CliError`, `cliArgs`, `required`, `intArg` (Task 2).
- Produces: `parseLocalDateTime(text, tz): number | null`, `formatDateTime(at, tz)` ("2026-11-14 18:00 CET"), `formatTime(at, tz)` ("14:31:05"), `formatDate(at, tz)` ("2026-12-14"), `isTimeZone(tz)`.
- Produces: `normalizePassphrase(text)`, `hashPassphrase(passphrase): Promise<string>`, `verifyPassphrase(attempt, encoded): Promise<boolean>`, `generatePassphrase(randomInt)`, `MAX_ATTEMPT_LENGTH` (200), `MIN_PASSPHRASE_LENGTH` (8).
- Produces: `eventState(event, now): 'scheduled' | 'open' | 'closed' | 'wiped'`.
- Produces: `renderDelivery(title, instructions, code, html = true)`, `deliveryLength(title, instructions)`, `escapeHtml(text)`, `MAX_MESSAGE_LENGTH` (4096).
- Produces: `checkGroup(api, chatId): Promise<{ title; botStatus }>`, `requireBotAdmin(api, chatId): Promise<string>`, `requireEvent(env): EventRow`, `eventCreate`.
- Produces (tests): `Harness.createEvent(extra)`, which creates "Swarm booth" for `GROUP_ID`, open 2026-11-14 10:00–18:00 UTC, with the passphrase `PASSPHRASE`.

- [ ] **Step 1: Add `createEvent` to the harness**

In `src/test/harness.ts`, add this method inside the `Harness` class, just before `close()`:

```ts
  createEvent(extra: string[] = []): Promise<CliResult> {
    return this.cli(
      [
        'event', 'create', '--title', 'Swarm booth', `--group=${GROUP_ID}`,
        '--opens', '2026-11-14 10:00', '--closes', '2026-11-14 18:00', '--tz', 'UTC',
        '--instructions', this.instructionsFile, ...extra,
      ],
      { tty: true, answers: [PASSPHRASE, PASSPHRASE] },
    );
  }
```

- [ ] **Step 2: Write the failing test**

`src/cli/event.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { BOT_ID, GROUP_ID, Harness, PASSPHRASE } from '../test/harness.js';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.ok(['init']);
});
afterEach(() => h.close());

describe('dispenser event create', () => {
  test('creates the event and status shows it scheduled, in its time zone', async () => {
    const result = await h.createEvent();
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `created "Swarm booth" for group ${GROUP_ID} “Swarm booth chat”\n` +
        'open from 2026-11-14 10:00 UTC to 2026-11-14 18:00 UTC\n',
    );
    expect((await h.cli(['status'])).stdout).toMatch(/^Event     Swarm booth · SCHEDULED · opens 2026-11-14 10:00 UTC$/m);
  });

  test('reads and shows times in --tz', async () => {
    await h.ok(
      ['event', 'create', '--title', 'Swarm booth', `--group=${GROUP_ID}`, '--opens', '2026-11-14 10:00',
        '--closes', '2026-11-14 18:00', '--tz', 'Europe/Berlin', '--instructions', h.instructionsFile],
      { tty: true, answers: [PASSPHRASE, PASSPHRASE] },
    );
    h.clock.set('2026-11-14T09:30:00Z'); // 10:30 in Berlin
    expect((await h.cli(['status'])).stdout).toMatch(/OPEN · closes 2026-11-14 18:00 CET$/m);
  });

  test('refuses a second event', async () => {
    await h.createEvent();
    const again = await h.createEvent();
    expect(again.code).toBe(1);
    expect(again.stderr).toBe('error: an event already exists; this version holds one event per database\n');
  });

  test('refuses a group where the bot is not an admin', async () => {
    h.telegram.setStatus(GROUP_ID, BOT_ID, 'member');
    const result = await h.createEvent();
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/the bot is not an admin in -1001234567890 “Swarm booth chat” \(its status is member\)/);
    expect((await h.cli(['status'])).stdout).toMatch(/^No event yet/);
  });

  test('refuses a group Telegram does not know', async () => {
    h.telegram.failNext('getChat', { error_code: 400, description: 'Bad Request: chat not found' });
    const result = await h.createEvent();
    expect(result.stderr).toBe('error: could not check group -1001234567890: Bad Request: chat not found\n');
  });

  test('the passphrase prompt needs a terminal', async () => {
    const result = await h.cli(['event', 'create', '--title', 'T', `--group=${GROUP_ID}`, '--opens',
      '2026-11-14 10:00', '--closes', '2026-11-14 18:00', '--instructions', h.instructionsFile]);
    expect(result.stderr).toMatch(/needs a terminal.*--passphrase-generate/);
  });

  test('refuses mismatched or short passphrases', async () => {
    const args = ['event', 'create', '--title', 'T', `--group=${GROUP_ID}`, '--opens', '2026-11-14 10:00',
      '--closes', '2026-11-14 18:00', '--instructions', h.instructionsFile];
    expect((await h.cli(args, { tty: true, answers: ['orbit maple', 'orbit maples'] })).stderr).toBe(
      'error: the passphrases do not match\n',
    );
    expect((await h.cli(args, { tty: true, answers: ['  a  b ', '  a  b '] })).stderr).toBe(
      'error: the passphrase must have at least 8 characters\n',
    );
  });

  test('--passphrase-generate prints three words from the EFF short list, once', async () => {
    h.randomInts = [0, 1, 1295];
    const result = await h.createEvent(['--passphrase-generate']);
    expect(result.stdout).toMatch(/^passphrase: acid acorn zoom$/m);
  });

  test.each([
    [['--opens', '2026-11-14 18:00', '--closes', '2026-11-14 10:00'], 'error: --opens must be before --closes\n'],
    [['--opens', '2026-11-13 10:00', '--closes', '2026-11-13 18:00'], 'error: --closes must be in the future\n'],
    [['--opens', '14.11.2026 10:00'], 'error: --opens must look like "YYYY-MM-DD HH:mm", got "14.11.2026 10:00"\n'],
    [['--opens', '2026-02-30 10:00'], 'error: --opens must look like "YYYY-MM-DD HH:mm", got "2026-02-30 10:00"\n'],
    [['--tz', 'Mars/Olympus'], 'error: unknown time zone "Mars/Olympus"\n'],
    [['--trip-rate', '5/5'], 'error: --trip-rate must be <n>/<seconds>, with n at least 1 and seconds from 10 to 3600\n'],
    [['--max-attempts', '0'], 'error: --max-attempts must be a whole number from 1 to 100\n'],
    [['--group=12345'], `error: --group must be a whole number from ${Number.MIN_SAFE_INTEGER} to -1\n`],
  ])('refuses %j', async (override, error) => {
    expect((await h.createEvent(override)).stderr).toBe(error);
  });

  test('refuses instructions that would push the code message over 4,096 characters', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(h.instructionsFile, 'x'.repeat(4000));
    expect((await h.createEvent()).stderr).toMatch(/^error: the code message would be 4\d{3} characters; Telegram allows 4096/);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm vitest run src/cli/event.test.ts`
Expected: FAIL, 17 tests; `event create` is not a command yet, so stderr shows the usage text, for example `expected 'usage: dispenser <command>…' to be 'error: --closes must be in the future…'`.

- [ ] **Step 4: Generate the word list**

```bash
curl -fsSL https://www.eff.org/files/2016/09/08/eff_short_wordlist_1.txt \
  | tr -d '\r' \
  | awk -F'\t' 'BEGIN { print "// EFF short word list 1 (CC BY 3.0 US): https://www.eff.org/dice"; print "export const WORDLIST: readonly string[] = [" } { printf "  \"%s\",\n", $2 } END { print "];" }' \
  > src/core/wordlist.ts
grep -c '^  "' src/core/wordlist.ts
sed -n '3,5p;1298p' src/core/wordlist.ts
```

Expected: `1296`, then `"acid",`, `"acorn",`, `"acre",` and `"zoom",`.

- [ ] **Step 5: Write time, passphrase and event state**

`src/time.ts`:

```ts
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  zone: string;
}

function wallClock(at: number, tz: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
    second: Number(part('second')),
    zone: part('timeZoneName'),
  };
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Parses "YYYY-MM-DD HH:mm" as wall-clock time in `tz`. Returns UTC milliseconds, or null if malformed. */
export function parseLocalDateTime(text: string, tz: string): number | null {
  const match = LOCAL_DATE_TIME.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }
  const offset = (at: number): number => {
    const w = wallClock(at, tz);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(at / 1000) * 1000;
  };
  return wall - offset(wall - offset(wall));
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** "2026-11-14 18:00 CET" */
export function formatDateTime(at: number, tz: string): string {
  const w = wallClock(at, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)} ${w.zone}`;
}

/** "14:31:05" */
export function formatTime(at: number, tz: string): string {
  const w = wallClock(at, tz);
  return `${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

/** "2026-12-14" */
export function formatDate(at: number, tz: string): string {
  const w = wallClock(at, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}
```

`src/core/passphrase.ts`:

```ts
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
```

`src/core/event-state.ts`:

```ts
import type { EventRow } from '../store/events.js';

export type EventState = 'scheduled' | 'open' | 'closed' | 'wiped';

/** Derived from timestamps on every read; never stored. */
export function eventState(event: EventRow, now: number): EventState {
  if (event.wipedAt !== null) return 'wiped';
  if (event.closedAt !== null || now >= event.closesAt) return 'closed';
  if (now < event.opensAt) return 'scheduled';
  return 'open';
}
```

- [ ] **Step 6: Write the code message**

`src/bot/messages.ts` (the CLI uses it to check the 4,096-character limit; Task 5 adds the replies):

```ts
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
```

- [ ] **Step 7: Write the group check and the command**

`src/cli/group.ts`:

```ts
import { GrammyError, type Api } from 'grammy';
import type { ChatMember } from 'grammy/types';
import { CliError } from './errors.js';

export interface GroupCheck {
  title: string;
  botStatus: ChatMember['status'];
}

/** Asks Telegram live for the group's title and the bot's status there. */
export async function checkGroup(api: Api, chatId: number): Promise<GroupCheck> {
  const me = await api.getMe();
  const chat = await api.getChat(chatId);
  const member = await api.getChatMember(chatId, me.id);
  return { title: 'title' in chat && chat.title ? chat.title : String(chatId), botStatus: member.status };
}

/** For create and edit: the bot must be an admin in the group. Returns the group's title. */
export async function requireBotAdmin(api: Api, chatId: number): Promise<string> {
  let check: GroupCheck;
  try {
    check = await checkGroup(api, chatId);
  } catch (err) {
    if (err instanceof GrammyError) throw new CliError(`could not check group ${chatId}: ${err.description}`);
    throw err;
  }
  if (check.botStatus !== 'administrator') {
    throw new CliError(
      `the bot is not an admin in ${chatId} “${check.title}” (its status is ${check.botStatus}); promote it first`,
    );
  }
  return check.title;
}
```

`src/cli/commands/event.ts`:

```ts
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
```

In `src/cli/run-cli.ts`, add the import next to the other command imports:

```ts
import { eventCreate } from './commands/event.js';
```

and add to `COMMANDS`:

```ts
  'event create': eventCreate,
```


Replace `src/cli/commands/status.ts` with:

```ts
import { parseArgs } from 'node:util';
import { eventState } from '../../core/event-state.js';
import { getEvent, type EventRow } from '../../store/events.js';
import { formatDateTime } from '../../time.js';
import type { CommandEnv } from '../env.js';
import { cliArgs } from '../errors.js';

const label = (name: string): string => name.padEnd(10);

function stateLine(event: EventRow, now: number): string {
  const state = eventState(event, now);
  switch (state) {
    case 'scheduled':
      return `SCHEDULED · opens ${formatDateTime(event.opensAt, event.tz)}`;
    case 'open':
      return `OPEN · closes ${formatDateTime(event.closesAt, event.tz)}`;
    case 'closed':
      return event.exportedAt === null ? 'CLOSED · next: dispenser export' : 'CLOSED · exported · next: dispenser wipe';
    case 'wiped':
      return 'WIPED';
  }
}

export function status(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const db = env.db();
  const event = getEvent(db);
  if (!event) {
    env.out('No event yet. Create one with "dispenser event create".');
    return;
  }
  env.out(`${label('Event')}${event.title} · ${stateLine(event, env.deps.clock.now())}`);
}
```

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run src/cli/event.test.ts`
Expected: `Tests  17 passed (17)`.

- [ ] **Step 9: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  29 passed (29)`.

- [ ] **Step 10: Commit**

```bash
git add src/time.ts src/core/wordlist.ts src/core/passphrase.ts src/core/event-state.ts src/bot/messages.ts src/cli/group.ts src/cli/commands/event.ts src/cli/run-cli.ts src/cli/commands/status.ts src/test/harness.ts src/cli/event.test.ts
git commit -s -m "feat(cli): create the event with dispenser event create" -m "- parse and show wall-clock times in the event time zone
- hash passphrases with scrypt and generate eff word passphrases
- check live that the bot is an admin in the group
- show the event state in status"
```

---

### Task 4: `dispenser import`

**Files:**
- Create: `src/store/codes.ts`, `src/cli/commands/import.ts`
- Modify: `src/cli/run-cli.ts`, `src/cli/commands/status.ts`, `src/test/harness.ts`
- Test: `src/cli/import.test.ts`

**Interfaces:**
- Consumes: `parseCodes` (Task 1), `eventState` (Task 3), `requireEvent` (Task 3).
- Produces: `countCodes(db, eventId): { claimed; unclaimed }`, `hasAddress(db, eventId, address)`, `insertCodes(db, eventId, codes)`, the types `CheckinStatus` and `CheckinAnswer`, and `CHECKIN_ANSWERS`.
- Produces (tests): `Harness.importKeys(keys)` and `Harness.openEvent({ keys?, extra? })`, which runs init, event create and import (default `key(1)`, `key(2)`, `key(3)`) and sets the clock to the opening time, 2026-11-14 10:00 UTC.

- [ ] **Step 1: Add `importKeys` and `openEvent` to the harness**

In `src/test/harness.ts`, add `import { key } from './keys.js';` to the imports, and add these methods inside the class, just before `close()`:

```ts
  importKeys(keys: readonly string[]): Promise<CliResult> {
    return this.ok(['import', '-', '--yes'], { stdin: keys.join('\n') });
  }

  /** init → event create → import → clock at the opening time, 2026-11-14 10:00 UTC. */
  async openEvent(options: { keys?: readonly string[]; extra?: string[] } = {}): Promise<void> {
    await this.ok(['init']);
    const created = await this.createEvent(options.extra);
    if (created.code !== 0) throw new Error(`event create failed:\n${created.stderr}`);
    await this.importKeys(options.keys ?? [key(1), key(2), key(3)]);
    this.clock.set('2026-11-14T10:00:00Z');
  }
```

- [ ] **Step 2: Write the failing test**

`src/cli/import.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness } from '../test/harness.js';
import { key } from '../test/keys.js';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.ok(['init']);
  await h.createEvent();
});
afterEach(() => h.close());

const claimsLine = async () => (await h.cli(['status'])).stdout.match(/^Claims .*$/m)?.[0];

describe('dispenser import', () => {
  test('is a dry run without --yes', async () => {
    const result = await h.cli(['import', '-'], { stdin: `${key(1)}\n${key(2)}` });
    expect(result.stdout).toBe('parsed 2 keys; nothing imported (dry run). Run again with --yes to import.\n');
    expect(await claimsLine()).toBe('Claims    0 claimed · 0 left');
  });

  test('imports with --yes', async () => {
    const result = await h.cli(['import', '-', '--yes'], { stdin: `${key(1)}\n${key(2)}\n${key(3)}\n` });
    expect(result.stdout).toBe('imported 3 keys\n');
    expect(await claimsLine()).toBe('Claims    0 claimed · 3 left');
  });

  test('reads a file path', async () => {
    const { writeFileSync } = await import('node:fs');
    const path = `${h.dir}/keys.txt`;
    writeFileSync(path, key(1));
    expect((await h.cli(['import', path, '--yes'])).stdout).toBe('imported 1 keys\n');
  });

  test('aborts on any bad line, imports nothing, and never echoes a key', async () => {
    const bad = `0x${'0'.repeat(64)}`;
    const result = await h.cli(['import', '-', '--yes'], { stdin: `${key(1)}\n${bad}\n${key(1)}` });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'line 2: not a valid private key\nline 3: duplicate of line 1\n' +
        'error: import aborted: 2 problem(s); nothing was imported\n',
    );
    expect(result.stdout + result.stderr).not.toContain(key(1).slice(2));
    expect(await claimsLine()).toBe('Claims    0 claimed · 0 left');
  });

  test('aborts when a key is already in the database', async () => {
    await h.importKeys([key(1)]);
    const result = await h.cli(['import', '-', '--yes'], { stdin: `${key(2)}\n${key(1)}` });
    expect(result.stderr).toMatch(/^line 2: this key is already in the database\n/);
    expect(await claimsLine()).toBe('Claims    0 claimed · 1 left');
  });

  test('refuses empty input', async () => {
    expect((await h.cli(['import', '-', '--yes'], { stdin: '\n\n' })).stderr).toBe('error: no keys found in the input\n');
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm vitest run src/cli/import.test.ts`
Expected: FAIL, 6 tests; `import` is not a command yet, for example `expected '' to be 'imported 3 keys\n'`.

- [ ] **Step 4: Write the codes store and the command**

`src/store/codes.ts` (later tasks append to it):

```ts
import type { Db } from './db.js';

export type CheckinStatus = 'sent' | 'unreachable' | 'failed';

/** The six check-in buttons; the schema's CHECK constraint lists the same values. */
export const CHECKIN_ANSWERS = [
  'uploaded',
  'not_yet',
  'stuck_install',
  'stuck_import',
  'stuck_upload',
  'stuck_other',
] as const;

export type CheckinAnswer = (typeof CHECKIN_ANSWERS)[number];

export function countCodes(db: Db, eventId: number): { claimed: number; unclaimed: number } {
  return db
    .prepare(
      `SELECT COUNT(claimed_by) AS claimed,
         COUNT(CASE WHEN claimed_by IS NULL AND private_key IS NOT NULL THEN 1 END) AS unclaimed
       FROM codes WHERE event_id = ?`,
    )
    .get(eventId) as { claimed: number; unclaimed: number };
}

export function hasAddress(db: Db, eventId: number, address: string): boolean {
  return db.prepare('SELECT 1 FROM codes WHERE event_id = ? AND address = ?').get(eventId, address) !== undefined;
}

export function insertCodes(
  db: Db,
  eventId: number,
  codes: ReadonlyArray<{ privateKey: string; address: string }>,
): void {
  const insert = db.prepare('INSERT INTO codes (event_id, private_key, address) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const code of codes) insert.run(eventId, code.privateKey, code.address);
  })();
}
```

`src/cli/commands/import.ts`:

```ts
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
```

In `src/cli/run-cli.ts`, add the import next to the other command imports:

```ts
import { importCodes } from './commands/import.js';
```

and add to `COMMANDS`:

```ts
  import: importCodes,
```


Replace `src/cli/commands/status.ts` with:

```ts
import { parseArgs } from 'node:util';
import { eventState } from '../../core/event-state.js';
import { countCodes } from '../../store/codes.js';
import { getEvent, type EventRow } from '../../store/events.js';
import { formatDateTime } from '../../time.js';
import type { CommandEnv } from '../env.js';
import { cliArgs } from '../errors.js';

const label = (name: string): string => name.padEnd(10);

function stateLine(event: EventRow, now: number): string {
  const state = eventState(event, now);
  switch (state) {
    case 'scheduled':
      return `SCHEDULED · opens ${formatDateTime(event.opensAt, event.tz)}`;
    case 'open':
      return `OPEN · closes ${formatDateTime(event.closesAt, event.tz)}`;
    case 'closed':
      return event.exportedAt === null ? 'CLOSED · next: dispenser export' : 'CLOSED · exported · next: dispenser wipe';
    case 'wiped':
      return 'WIPED';
  }
}

export function status(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const db = env.db();
  const event = getEvent(db);
  if (!event) {
    env.out('No event yet. Create one with "dispenser event create".');
    return;
  }
  const { claimed, unclaimed } = countCodes(db, event.id);
  env.out(`${label('Event')}${event.title} · ${stateLine(event, env.deps.clock.now())}`);
  env.out(`${label('Claims')}${claimed} claimed · ${unclaimed} left`);
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/cli/import.test.ts`
Expected: `Tests  6 passed (6)`.

- [ ] **Step 6: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  35 passed (35)`.

- [ ] **Step 7: Commit**

```bash
git add src/store/codes.ts src/cli/commands/import.ts src/cli/run-cli.ts src/cli/commands/status.ts src/test/harness.ts src/cli/import.test.ts
git commit -s -m "feat(cli): import gift codes with dispenser import" -m "- dry run by default; import with --yes
- abort on any bad line or known key, importing nothing
- show claimed and unclaimed counts in status"
```

---

### Task 5: The bot hands out a code

**Files:**
- Create: `src/bot/flow.ts`, `src/bot/rate-limit.ts`, `src/bot/claim-flow.ts`, `src/bot/create-bot.ts`, `src/store/attempts.ts`
- Create (tests): `src/test/updates.ts`
- Modify: `src/bot/messages.ts`, `src/store/codes.ts`, `src/test/harness.ts`
- Test: `src/bot/claim.test.ts`, `src/bot/rate-limit.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `getEvent` (Task 2), `verifyPassphrase`, `renderDelivery` (Task 3).
- Produces: `createBot(deps: BotDeps): DispenserBot`, with `BotDeps = { token; botInfo; dataDir; adminUserId; clock; log; transformers?; before?; rateLimit? }` and `DispenserBot = { bot; handleUpdate(update): Promise<void>; close() }`.
- Produces: `Flow = { db; clock; log; adminUserId; botId }`, `Reply = { text; html }`, `plain(text)`; `startReply(flow)`, `textReply(api, flow, userId, text): Promise<TextOutcome>` with `TextOutcome = { reply; trippedEvent? }`.
- Produces: `msg` (every claimant reply), `assignNextCode(db, eventId, userId, now)`, `failuresOf(db, eventId, userId)`, `recordFailure(db, eventId, userId)` (Task 8 replaces it), `createRateLimiter(clock, limit)`, `DEFAULT_RATE_LIMIT`.
- Produces (tests): `Harness.bot({ rateLimit? })`, `restartBot()`, `send(update)`, `say(userId, text)` (advances the clock 1 s first), `tap(userId, data)`, `lastTextTo(chatId)`, and `deliveryText(privateKey, address, title?)`; update builders `textUpdate`, `locationUpdate`, `callbackUpdate`, `botStatusUpdate`, `supergroup`.

This task builds the happy path only.
Tasks 6 to 10 add the remaining rows of spec §8.2, each behind its own failing test.

- [ ] **Step 1: Write the test utilities**

`src/test/updates.ts`:

```ts
import type { Chat, Update, User } from 'grammy/types';
import { chatMember, type MemberStatus } from './telegram-fake.js';

const DATE = 1_794_650_400;
let lastId = 0;

export const userOf = (id: number): User => ({ id, is_bot: false, first_name: `User${id}` });
export const privateChat = (id: number): Chat.PrivateChat => ({ id, type: 'private', first_name: `User${id}` });
export const supergroup = (id: number, title: string): Chat.SupergroupChat => ({ id, type: 'supergroup', title });

type MessageChat = Chat.PrivateChat | Chat.GroupChat | Chat.SupergroupChat;

export function textUpdate(from: number, text: string, chat: MessageChat = privateChat(from)): Update {
  lastId += 1;
  const command = /^\/\w+/.exec(text)?.[0];
  return {
    update_id: lastId,
    message: {
      message_id: lastId, date: DATE, chat, from: userOf(from), text,
      ...(command ? { entities: [{ type: 'bot_command', offset: 0, length: command.length }] } : {}),
    },
  };
}

export function locationUpdate(from: number): Update {
  lastId += 1;
  return {
    update_id: lastId,
    message: {
      message_id: lastId, date: DATE, chat: privateChat(from), from: userOf(from),
      location: { latitude: 52.52, longitude: 13.405 },
    },
  };
}

export function callbackUpdate(from: number, data: string, chat: MessageChat = privateChat(from)): Update {
  lastId += 1;
  return {
    update_id: lastId,
    callback_query: {
      id: `cb${lastId}`, from: userOf(from), chat_instance: 'chat-instance', data,
      message: { message_id: 1, date: DATE, chat, from: userOf(777000), text: 'Did you upload your first file?' },
    },
  };
}

export function botStatusUpdate(options: {
  chat: Chat.SupergroupChat;
  by: number;
  botId: number;
  from: MemberStatus;
  to: MemberStatus;
}): Update {
  lastId += 1;
  const bot: User = { id: options.botId, is_bot: true, first_name: 'Gift Dispenser' };
  return {
    update_id: lastId,
    my_chat_member: {
      chat: options.chat, from: userOf(options.by), date: DATE,
      old_chat_member: chatMember(options.from, bot), new_chat_member: chatMember(options.to, bot),
    },
  };
}
```

Replace `src/test/harness.ts` with:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Update } from 'grammy/types';
import { createBot, type DispenserBot } from '../bot/create-bot.js';
import type { RateLimit } from '../bot/rate-limit.js';
import { runCli, type CliResult } from '../cli/run-cli.js';
import { createLogger, type Logger } from '../log.js';
import { FakeClock } from './fake-clock.js';
import { key } from './keys.js';
import { TelegramFake } from './telegram-fake.js';
import { callbackUpdate, textUpdate } from './updates.js';

export const TOKEN = '777000:AAH-test-token-secret-value';
export const BOT_ID = 777000;
export const ADMIN_ID = 1000;
export const GROUP_ID = -1001234567890;
export const PASSPHRASE = 'Orbit Maple Lantern';
export const INSTRUCTIONS = 'Import the key into your Bee node: https://docs.ethswarm.org';

/** The code message as spec §8.6 words it, written out by hand. */
export function deliveryText(privateKey: string, address: string, title = 'Swarm booth'): string {
  return [
    `Your gift code for ${title}:`,
    `<tg-spoiler><code>${privateKey}</code></tg-spoiler>`,
    `Wallet address: <code>${address}</code>`,
    '',
    INSTRUCTIONS,
    '',
    'Save your code somewhere safe now: the bot deletes all codes shortly after the event.',
    'Lost this message? Send /mycode to see it again.',
  ].join('\n');
}

export interface CliOptions {
  stdin?: string;
  tty?: boolean;
  answers?: string[];
}

/** One temp data directory with a fake clock, a fake Telegram and captured logs, driven through the seams. */
export class Harness {
  readonly dir = mkdtempSync(join(tmpdir(), 'dispenser-'));
  readonly dataDir = this.dir;
  readonly instructionsFile = join(this.dir, 'instructions.txt');
  readonly clock = new FakeClock(Date.parse('2026-11-14T09:00:00Z'));
  readonly telegram = new TelegramFake(BOT_ID, GROUP_ID);
  readonly logs: string[] = [];
  readonly log: Logger = createLogger((line) => this.logs.push(line), [TOKEN], this.clock);
  /** Consumed by randomInt in order; 0 once empty. */
  randomInts: number[] = [];
  fetch: typeof fetch = async () => {
    throw new Error('unexpected fetch');
  };
  readonly sleeps: number[] = [];
  private current: DispenserBot | undefined;

  constructor() {
    writeFileSync(this.instructionsFile, INSTRUCTIONS);
  }

  cli(argv: string[], options: CliOptions = {}): Promise<CliResult> {
    const answers = [...(options.answers ?? [])];
    return runCli(argv, async () => options.stdin ?? '', {
      dataDir: this.dataDir,
      token: TOKEN,
      defaultTz: 'UTC',
      clock: this.clock,
      log: this.log,
      terminal: { isTTY: options.tty ?? false, ask: async () => answers.shift() ?? '' },
      randomInt: (max) => {
        const n = this.randomInts.shift() ?? 0;
        if (n >= max) throw new RangeError(`randomInt(${max}) cannot return ${n}`);
        return n;
      },
      transformers: [this.telegram.transformer],
      fetch: (input, init) => this.fetch(input, init),
      blockscoutUrl: 'https://blockscout.test',
      sleep: async (ms) => {
        this.sleeps.push(ms);
      },
    });
  }

  /** Runs a CLI command that must succeed, for test setup. */
  async ok(argv: string[], options: CliOptions = {}): Promise<CliResult> {
    const result = await this.cli(argv, options);
    if (result.code !== 0) throw new Error(`dispenser ${argv.join(' ')} failed:\n${result.stderr}`);
    return result;
  }

  createEvent(extra: string[] = []): Promise<CliResult> {
    return this.cli(
      [
        'event', 'create', '--title', 'Swarm booth', `--group=${GROUP_ID}`,
        '--opens', '2026-11-14 10:00', '--closes', '2026-11-14 18:00', '--tz', 'UTC',
        '--instructions', this.instructionsFile, ...extra,
      ],
      { tty: true, answers: [PASSPHRASE, PASSPHRASE] },
    );
  }

  importKeys(keys: readonly string[]): Promise<CliResult> {
    return this.ok(['import', '-', '--yes'], { stdin: keys.join('\n') });
  }

  /** init → event create → import → clock at the opening time, 2026-11-14 10:00 UTC. */
  async openEvent(options: { keys?: readonly string[]; extra?: string[] } = {}): Promise<void> {
    await this.ok(['init']);
    const created = await this.createEvent(options.extra);
    if (created.code !== 0) throw new Error(`event create failed:\n${created.stderr}`);
    await this.importKeys(options.keys ?? [key(1), key(2), key(3)]);
    this.clock.set('2026-11-14T10:00:00Z');
  }

  bot(options: { rateLimit?: RateLimit } = {}): DispenserBot {
    this.current ??= createBot({
      token: TOKEN,
      botInfo: this.telegram.botInfo,
      dataDir: this.dataDir,
      adminUserId: ADMIN_ID,
      clock: this.clock,
      log: this.log,
      transformers: [this.telegram.transformer],
      ...options,
    });
    return this.current;
  }

  /** A new bot process over the same data directory. */
  restartBot(): DispenserBot {
    this.current?.close();
    this.current = undefined;
    return this.bot();
  }

  send(update: Update): Promise<void> {
    return this.bot().handleUpdate(update);
  }

  /** A private message one second after the previous one, so the default rate limit never drops it. */
  async say(userId: number, text: string): Promise<void> {
    this.clock.advance(1000);
    await this.send(textUpdate(userId, text));
  }

  async tap(userId: number, data: string): Promise<void> {
    this.clock.advance(1000);
    await this.send(callbackUpdate(userId, data));
  }

  lastTextTo(chatId: number): string | undefined {
    return this.telegram.textsTo(chatId).at(-1);
  }

  close(): void {
    this.current?.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Write the failing tests**

`src/bot/claim.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createBot } from './create-bot.js';
import { ADMIN_ID, deliveryText, Harness, PASSPHRASE, TOKEN } from '../test/harness.js';
import { ADDRESS_1, key } from '../test/keys.js';

const ALICE = 5001;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

describe('claiming a code', () => {
  test('/start explains what to do', async () => {
    await h.say(ALICE, '/start');
    expect(h.lastTextTo(ALICE)).toBe(
      "To get your gift code for Swarm booth, join the event's Telegram group, then send me the passphrase you were given.",
    );
  });

  test('the right passphrase delivers the first code as a spoiler, with the address and instructions', async () => {
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe(deliveryText(key(1), ADDRESS_1));
    expect(h.telegram.sent.at(-1)?.parseMode).toBe('HTML');
  });

  test('the passphrase matches regardless of case and spacing', async () => {
    await h.say(ALICE, '  orbit   MAPLE lantern ');
    expect(h.lastTextTo(ALICE)).toBe(deliveryText(key(1), ADDRESS_1));
  });

  test('phone keyboards: non-breaking spaces, em spaces and full-width letters still match', async () => {
    await h.say(ALICE, '\u00a0Orbit\u2003maple ＬＡＮＴＥＲＮ');
    expect(h.lastTextTo(ALICE)).toBe(deliveryText(key(1), ADDRESS_1));
  });

  test('escapes HTML in the title and instructions, so Telegram accepts the message', async () => {
    h.close();
    h = new Harness();
    writeFileSync(h.instructionsFile, 'Docs: https://docs.ethswarm.org/?a=1&b=<2>');
    await h.openEvent({ extra: ['--title', 'Swarm <3 & co'] });
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for Swarm &lt;3 &amp; co:\n/);
    expect(h.lastTextTo(ALICE)).toContain('\nDocs: https://docs.ethswarm.org/?a=1&amp;b=&lt;2&gt;\n');
  });

  test('a wrong passphrase says how many tries are left', async () => {
    await h.say(ALICE, 'hello?');
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 4 tries left.");
  });

  test('the bot refuses to start without a database', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dispenser-empty-'));
    try {
      expect(() =>
        createBot({ token: TOKEN, botInfo: h.telegram.botInfo, dataDir: empty, adminUserId: ADMIN_ID, clock: h.clock, log: h.log }),
      ).toThrow(/no database at .*run "dispenser init" first/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
```

`src/bot/rate-limit.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { textUpdate } from '../test/updates.js';

const ALICE = 5001;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

describe('rate limit', () => {
  test('an account may send 3 updates per 2 seconds; the rest are dropped silently', async () => {
    for (let i = 0; i < 5; i += 1) await h.send(textUpdate(ALICE, `guess ${i}`));
    expect(h.telegram.textsTo(ALICE)).toHaveLength(3);
    h.clock.advance(2000);
    await h.send(textUpdate(ALICE, PASSPHRASE));
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code/);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run src/bot`
Expected: FAIL with `Error: Cannot find module '../bot/create-bot.js'`.

- [ ] **Step 4: Add the replies**

Insert at the top of `src/bot/messages.ts`:

```ts
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
```

- [ ] **Step 5: Write the stores the flow needs**

Append to `src/store/codes.ts`:

```ts
/** Assigns the unclaimed code with the lowest id. Call it inside a transaction. */
export function assignNextCode(
  db: Db,
  eventId: number,
  userId: number,
  now: number,
): { privateKey: string; address: string } | undefined {
  const next = db
    .prepare(
      `SELECT id, private_key AS privateKey, address FROM codes
       WHERE event_id = ? AND claimed_by IS NULL AND private_key IS NOT NULL ORDER BY id LIMIT 1`,
    )
    .get(eventId) as { id: number; privateKey: string; address: string } | undefined;
  if (!next) return undefined;
  db.prepare('UPDATE codes SET claimed_by = ?, claimed_at = ? WHERE id = ?').run(userId, now, next.id);
  return { privateKey: next.privateKey, address: next.address };
}
```

`src/store/attempts.ts`:

```ts
import type { Db } from './db.js';

export function failuresOf(db: Db, eventId: number, userId: number): number {
  const row = db
    .prepare('SELECT failures FROM attempts WHERE event_id = ? AND telegram_user_id = ?')
    .get(eventId, userId) as { failures: number } | undefined;
  return row?.failures ?? 0;
}

/** Counts one wrong passphrase. Returns the account's failures so far. */
export function recordFailure(db: Db, eventId: number, userId: number): number {
  db.prepare(
    `INSERT INTO attempts (event_id, telegram_user_id, failures) VALUES (?, ?, 1)
     ON CONFLICT (event_id, telegram_user_id) DO UPDATE SET failures = failures + 1`,
  ).run(eventId, userId);
  return failuresOf(db, eventId, userId);
}
```

- [ ] **Step 6: Write the bot**

`src/bot/flow.ts`:

```ts
import type { Clock } from '../clock.js';
import type { Logger } from '../log.js';
import type { Db } from '../store/db.js';

/** What every bot handler needs. */
export interface Flow {
  db: Db;
  clock: Clock;
  log: Logger;
  adminUserId: number;
  botId: number;
}

export interface Reply {
  text: string;
  html: boolean;
}

export const plain = (text: string): Reply => ({ text, html: false });
```

`src/bot/rate-limit.ts`:

```ts
import type { Clock } from '../clock.js';

export interface RateLimit {
  limit: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimit = { limit: 3, windowMs: 2000 };

/** Returns a check that allows `limit` updates per account within `windowMs`. */
export function createRateLimiter(clock: Clock, { limit, windowMs }: RateLimit): (userId: number) => boolean {
  const seen = new Map<number, number[]>();
  return (userId) => {
    const now = clock.now();
    const recent = (seen.get(userId) ?? []).filter((t) => t > now - windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(now);
    seen.set(userId, recent);
    return allowed;
  };
}
```

`src/bot/claim-flow.ts`:

```ts
import type { Api } from 'grammy';
import { verifyPassphrase } from '../core/passphrase.js';
import { recordFailure } from '../store/attempts.js';
import { assignNextCode } from '../store/codes.js';
import { getEvent, type EventRow } from '../store/events.js';
import { plain, type Flow, type Reply } from './flow.js';
import { msg, renderDelivery } from './messages.js';

function codeReply(event: EventRow, code: { privateKey: string; address: string }): Reply {
  return { text: renderDelivery(event.title, event.instructions, code), html: true };
}

export function startReply(flow: Flow): string {
  const event = getEvent(flow.db);
  return event ? msg.start(event.title) : msg.noEventOpen;
}

export interface TextOutcome {
  reply: Reply;
  /** Set when this claim tripped the breaker, so the admin gets told. */
  trippedEvent?: EventRow;
}

/** Any non-command text: the claim flow of spec §8.2. Later tasks add the remaining rows. */
export async function textReply(_api: Api, flow: Flow, userId: number, text: string): Promise<TextOutcome> {
  const { db, clock, log } = flow;
  const event = getEvent(db);
  if (!event) return { reply: plain(msg.noEventOpen) };

  const right = event.passphraseHash !== null && (await verifyPassphrase(text, event.passphraseHash));
  if (!right) {
    const failures = recordFailure(db, event.id, userId);
    log.info('wrong passphrase', { user: userId, failures });
    return { reply: plain(msg.wrong(event.maxAttempts - failures)) };
  }
  const code = db.transaction(() => assignNextCode(db, event.id, userId, clock.now()))();
  if (!code) return { reply: plain(msg.allClaimed) };
  log.info('claimed', { user: userId, address: code.address });
  return { reply: codeReply(event, code) };
}
```

`src/bot/create-bot.ts`:

```ts
import { Bot, BotError, type Context, type Middleware, type Transformer } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { Clock } from '../clock.js';
import { errorFields, type Logger } from '../log.js';
import { openDatabase } from '../store/db.js';
import { startReply, textReply } from './claim-flow.js';
import type { Flow, Reply } from './flow.js';
import { msg } from './messages.js';
import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimit } from './rate-limit.js';

export interface BotDeps {
  token: string;
  botInfo: UserFromGetMe;
  dataDir: string;
  adminUserId: number;
  clock: Clock;
  log: Logger;
  /** Installed on the API client, e.g. auto-retry in production or the Telegram fake in tests. */
  transformers?: Transformer[];
  /** Installed ahead of every handler, e.g. the runner's sequentialize in production. */
  before?: Middleware<Context>[];
  rateLimit?: RateLimit;
}

export interface DispenserBot {
  bot: Bot;
  /** Handles one update the way the runner does: errors go to the bot's error handler. */
  handleUpdate(update: Update): Promise<void>;
  close(): void;
}

function updateType(update: Update): string {
  return Object.keys(update).find((key) => key !== 'update_id') ?? 'unknown';
}

export function createBot(deps: BotDeps): DispenserBot {
  const db = openDatabase(deps.dataDir);
  const bot = new Bot(deps.token, { botInfo: deps.botInfo });
  for (const transformer of deps.transformers ?? []) bot.api.config.use(transformer);
  for (const middleware of deps.before ?? []) bot.use(middleware);

  const flow: Flow = { db, clock: deps.clock, log: deps.log, adminUserId: deps.adminUserId, botId: deps.botInfo.id };
  const allow = createRateLimiter(deps.clock, deps.rateLimit ?? DEFAULT_RATE_LIMIT);
  const options = (reply: Reply) => (reply.html ? { parse_mode: 'HTML' as const } : {});

  const priv = bot.chatType('private');
  priv.use(async (ctx, next) => {
    if (allow(ctx.from.id)) await next();
  });
  priv.command('start', (ctx) => ctx.reply(startReply(flow)));
  priv.on('message:text', async (ctx) => {
    let outcome;
    try {
      outcome = await textReply(ctx.api, flow, ctx.from.id, ctx.message.text);
    } catch (err) {
      flow.log.error('claim flow failed', { user: ctx.from.id, ...errorFields(err) });
      await ctx.reply(msg.somethingWrong);
      return;
    }
    await ctx.reply(outcome.reply.text, options(outcome.reply));
  });

  bot.catch((err) => {
    deps.log.error('update failed', {
      updateId: err.ctx.update.update_id,
      updateType: updateType(err.ctx.update),
      ...errorFields(err.error),
    });
  });

  return {
    bot,
    async handleUpdate(update) {
      try {
        await bot.handleUpdate(update);
      } catch (err) {
        if (!(err instanceof BotError)) throw err;
        await bot.errorHandler(err);
      }
    },
    close: () => db.close(),
  };
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run src/bot`
Expected: `Tests  8 passed (8)`.

- [ ] **Step 8: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  43 passed (43)`.

- [ ] **Step 9: Commit**

```bash
git add src/bot/flow.ts src/bot/rate-limit.ts src/bot/claim-flow.ts src/bot/create-bot.ts src/bot/messages.ts src/store/attempts.ts src/store/codes.ts src/test/updates.ts src/test/harness.ts src/bot/claim.test.ts src/bot/rate-limit.test.ts
git commit -s -m "feat(bot): hand out a code for the right passphrase" -m "- deliver the code as a spoiler with the address and instructions
- count wrong passphrases and say how many tries are left
- drop updates beyond 3 per 2 seconds per account
- refuse to start without a database"
```

---

### Task 6: One code per account

**Files:**
- Create: `src/core/claim.ts`
- Modify: `src/store/codes.ts`, `src/bot/claim-flow.ts`, `src/bot/create-bot.ts`
- Test: `src/bot/one-code.test.ts`

**Interfaces:**
- Consumes: `assignNextCode` (Task 5).
- Produces: `claimOrGet(db, now, userId): ClaimResult`, the only function in the bot process that returns a key; `ClaimResult` is `code` (with `privateKey`, `address`, `isNew`), `wiped` or `pool_empty` here, and Tasks 9 and 10 add `closed` and `paused`.
- Produces: `findCodeByClaimer(db, eventId, userId): ClaimedCode | undefined`, the `ClaimedCode` type, `startReply(flow, userId)` and `myCodeReply(flow, userId): Reply`.

- [ ] **Step 1: Write the failing test**

`src/bot/one-code.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { deliveryText, Harness, PASSPHRASE } from '../test/harness.js';
import { ADDRESS_1, ADDRESS_2, key } from '../test/keys.js';
import { textUpdate } from '../test/updates.js';

const ALICE = 5001;
const BOB = 5002;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

/** The keys inside delivery messages. */
const deliveredKeys = (texts: string[]): string[] =>
  texts.flatMap((t) => /<tg-spoiler><code>(0x[0-9a-f]{64})<\/code>/.exec(t)?.[1] ?? []);

describe('one code per account', () => {
  test('a second passphrase from the same account re-sends the same code', async () => {
    await h.say(ALICE, PASSPHRASE);
    await h.say(ALICE, PASSPHRASE);
    await h.say(BOB, PASSPHRASE);
    expect(h.telegram.textsTo(ALICE)).toEqual([deliveryText(key(1), ADDRESS_1), deliveryText(key(1), ADDRESS_1)]);
    expect(h.lastTextTo(BOB)).toBe(deliveryText(key(2), ADDRESS_2));
  });

  test('50 concurrent passphrases from one account: every reply that carries a code carries the same one', async () => {
    // Up to max_attempts sends are checked at once; the rest are told to wait as "too many tries" (spec §8.5).
    const bot = h.bot({ rateLimit: { limit: 1000, windowMs: 2000 } });
    await Promise.all(Array.from({ length: 50 }, () => bot.handleUpdate(textUpdate(ALICE, PASSPHRASE))));
    expect(new Set(deliveredKeys(h.telegram.textsTo(ALICE)))).toEqual(new Set([key(1)]));
    expect(h.telegram.textsTo(ALICE)).not.toContain('Something went wrong. Please try again later.');
    await h.say(BOB, PASSPHRASE);
    expect(h.lastTextTo(BOB)).toBe(deliveryText(key(2), ADDRESS_2));
  });

  test('30 accounts against 20 codes: 20 distinct codes, then "all claimed"', async () => {
    h.close();
    h = new Harness();
    await h.openEvent({ keys: Array.from({ length: 20 }, (_, i) => key(i + 1)), extra: ['--trip-rate', '100/60'] });
    const bot = h.bot({ rateLimit: { limit: 1000, windowMs: 2000 } });
    const accounts = Array.from({ length: 30 }, (_, i) => 6000 + i);
    await Promise.all(accounts.map((id) => bot.handleUpdate(textUpdate(id, PASSPHRASE))));
    const replies = accounts.map((id) => h.lastTextTo(id) ?? '');
    expect(new Set(deliveredKeys(replies)).size).toBe(20);
    expect(replies.filter((r) => r === 'All codes have been claimed.')).toHaveLength(10);
  });

  test('a failed send keeps the claim, and the next message delivers the same code', async () => {
    h.telegram.failNext('sendMessage', new Error('network down'));
    await h.say(ALICE, PASSPHRASE);
    expect(h.telegram.textsTo(ALICE)).toEqual([]);
    await h.say(ALICE, 'did it work?');
    expect(h.lastTextTo(ALICE)).toBe(deliveryText(key(1), ADDRESS_1));
  });

  test('/mycode re-sends the code, and says so when there is none', async () => {
    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toBe("You don't have a code yet.");
    await h.say(ALICE, PASSPHRASE);
    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toBe(deliveryText(key(1), ADDRESS_1));
  });

  test('/start mentions /mycode once the account has a code', async () => {
    await h.say(ALICE, PASSPHRASE);
    await h.say(ALICE, '/start');
    expect(h.lastTextTo(ALICE)).toMatch(/\n\nYou already have a code\. Send \/mycode to see it again\.$/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/bot/one-code.test.ts`
Expected: FAIL, 5 tests, for example `expected 'That\'s not it. 4 tries left.' to be 'You don\'t have a code yet.'` (`/mycode` is still read as a passphrase).
"30 accounts against 20 codes" already passes, because assignment already skips claimed codes; it stays as a guard.

- [ ] **Step 3: Write `claimOrGet`**

Append to `src/store/codes.ts`:

```ts
export interface ClaimedCode {
  id: number;
  privateKey: string | null;
  address: string;
  claimedBy: number;
  claimedAt: number;
  checkinStatus: CheckinStatus | null;
  checkinAnswer: CheckinAnswer | null;
}

const CLAIMED = `SELECT id, private_key AS privateKey, address, claimed_by AS claimedBy, claimed_at AS claimedAt,
  checkin_status AS checkinStatus, checkin_answer AS checkinAnswer FROM codes`;

export function findCodeByClaimer(db: Db, eventId: number, userId: number): ClaimedCode | undefined {
  return db.prepare(`${CLAIMED} WHERE event_id = ? AND claimed_by = ?`).get(eventId, userId) as
    | ClaimedCode
    | undefined;
}
```

`src/core/claim.ts`:

```ts
import { assignNextCode, findCodeByClaimer } from '../store/codes.js';
import type { Db } from '../store/db.js';
import { getEvent } from '../store/events.js';

export type ClaimResult =
  | { kind: 'code'; privateKey: string; address: string; isNew: boolean }
  | { kind: 'wiped' }
  | { kind: 'pool_empty' };

/**
 * The only function in the bot process that returns a key: the caller's own, at most one.
 * One IMMEDIATE transaction, so concurrent claims from one account all get the same code.
 */
export function claimOrGet(db: Db, now: number, userId: number): ClaimResult {
  return db
    .transaction((): ClaimResult => {
      const event = getEvent(db);
      if (!event) return { kind: 'pool_empty' };
      const existing = findCodeByClaimer(db, event.id, userId);
      if (existing) {
        return existing.privateKey === null
          ? { kind: 'wiped' }
          : { kind: 'code', privateKey: existing.privateKey, address: existing.address, isNew: false };
      }
      const code = assignNextCode(db, event.id, userId, now);
      return code ? { kind: 'code', ...code, isNew: true } : { kind: 'pool_empty' };
    })
    .immediate();
}
```

- [ ] **Step 4: Use it in the flow and add `/mycode`**

Replace `src/bot/claim-flow.ts` with:

```ts
import type { Api } from 'grammy';
import { claimOrGet } from '../core/claim.js';
import { verifyPassphrase } from '../core/passphrase.js';
import { recordFailure } from '../store/attempts.js';
import { findCodeByClaimer } from '../store/codes.js';
import { getEvent, type EventRow } from '../store/events.js';
import { plain, type Flow, type Reply } from './flow.js';
import { msg, renderDelivery } from './messages.js';

function codeReply(event: EventRow, code: { privateKey: string; address: string }): Reply {
  return { text: renderDelivery(event.title, event.instructions, code), html: true };
}

export function startReply(flow: Flow, userId: number): string {
  const event = getEvent(flow.db);
  if (!event) return msg.noEventOpen;
  const hasCode = findCodeByClaimer(flow.db, event.id, userId) !== undefined;
  return hasCode ? `${msg.start(event.title)}\n\n${msg.startHasCode}` : msg.start(event.title);
}

export function myCodeReply(flow: Flow, userId: number): Reply {
  const event = getEvent(flow.db);
  const code = event ? findCodeByClaimer(flow.db, event.id, userId) : undefined;
  if (!event || !code) return plain(msg.noCodeYet);
  if (code.privateKey === null) return plain(msg.noLongerStored);
  return codeReply(event, { privateKey: code.privateKey, address: code.address });
}

export interface TextOutcome {
  reply: Reply;
  /** Set when this claim tripped the breaker, so the admin gets told. */
  trippedEvent?: EventRow;
}

/** Any non-command text: the claim flow of spec §8.2, in row order. */
export async function textReply(_api: Api, flow: Flow, userId: number, text: string): Promise<TextOutcome> {
  const { db, clock, log } = flow;
  const event = getEvent(db);
  if (!event) return { reply: plain(msg.noEventOpen) };

  const existing = findCodeByClaimer(db, event.id, userId);
  if (existing) {
    if (existing.privateKey === null) return { reply: plain(msg.noLongerStored) };
    return { reply: codeReply(event, { privateKey: existing.privateKey, address: existing.address }) };
  }

  const right = event.passphraseHash !== null && (await verifyPassphrase(text, event.passphraseHash));
  if (!right) {
    const failures = recordFailure(db, event.id, userId);
    log.info('wrong passphrase', { user: userId, failures });
    return { reply: plain(msg.wrong(event.maxAttempts - failures)) };
  }

  const result = claimOrGet(db, clock.now(), userId);
  switch (result.kind) {
    case 'code':
      if (result.isNew) log.info('claimed', { user: userId, address: result.address });
      return { reply: codeReply(event, result) };
    case 'wiped':
      return { reply: plain(msg.noLongerStored) };
    case 'pool_empty':
      return { reply: plain(msg.allClaimed) };
  }
}
```

Replace `src/bot/create-bot.ts` with:

```ts
import { Bot, BotError, type Context, type Middleware, type Transformer } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { Clock } from '../clock.js';
import { errorFields, type Logger } from '../log.js';
import { openDatabase } from '../store/db.js';
import { myCodeReply, startReply, textReply } from './claim-flow.js';
import type { Flow, Reply } from './flow.js';
import { msg } from './messages.js';
import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimit } from './rate-limit.js';

export interface BotDeps {
  token: string;
  botInfo: UserFromGetMe;
  dataDir: string;
  adminUserId: number;
  clock: Clock;
  log: Logger;
  /** Installed on the API client, e.g. auto-retry in production or the Telegram fake in tests. */
  transformers?: Transformer[];
  /** Installed ahead of every handler, e.g. the runner's sequentialize in production. */
  before?: Middleware<Context>[];
  rateLimit?: RateLimit;
}

export interface DispenserBot {
  bot: Bot;
  /** Handles one update the way the runner does: errors go to the bot's error handler. */
  handleUpdate(update: Update): Promise<void>;
  close(): void;
}

function updateType(update: Update): string {
  return Object.keys(update).find((key) => key !== 'update_id') ?? 'unknown';
}

export function createBot(deps: BotDeps): DispenserBot {
  const db = openDatabase(deps.dataDir);
  const bot = new Bot(deps.token, { botInfo: deps.botInfo });
  for (const transformer of deps.transformers ?? []) bot.api.config.use(transformer);
  for (const middleware of deps.before ?? []) bot.use(middleware);

  const flow: Flow = { db, clock: deps.clock, log: deps.log, adminUserId: deps.adminUserId, botId: deps.botInfo.id };
  const allow = createRateLimiter(deps.clock, deps.rateLimit ?? DEFAULT_RATE_LIMIT);
  const options = (reply: Reply) => (reply.html ? { parse_mode: 'HTML' as const } : {});

  const priv = bot.chatType('private');
  priv.use(async (ctx, next) => {
    if (allow(ctx.from.id)) await next();
  });
  priv.command('start', (ctx) => ctx.reply(startReply(flow, ctx.from.id)));
  priv.command('mycode', async (ctx) => {
    const reply = myCodeReply(flow, ctx.from.id);
    await ctx.reply(reply.text, options(reply));
  });
  priv.on('message:text', async (ctx) => {
    let outcome;
    try {
      outcome = await textReply(ctx.api, flow, ctx.from.id, ctx.message.text);
    } catch (err) {
      flow.log.error('claim flow failed', { user: ctx.from.id, ...errorFields(err) });
      await ctx.reply(msg.somethingWrong);
      return;
    }
    await ctx.reply(outcome.reply.text, options(outcome.reply));
  });

  bot.catch((err) => {
    deps.log.error('update failed', {
      updateId: err.ctx.update.update_id,
      updateType: updateType(err.ctx.update),
      ...errorFields(err.error),
    });
  });

  return {
    bot,
    async handleUpdate(update) {
      try {
        await bot.handleUpdate(update);
      } catch (err) {
        if (!(err instanceof BotError)) throw err;
        await bot.errorHandler(err);
      }
    },
    close: () => db.close(),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/bot/one-code.test.ts`
Expected: `Tests  6 passed (6)`.

- [ ] **Step 6: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  49 passed (49)`.

- [ ] **Step 7: Commit**

```bash
git add src/core/claim.ts src/store/codes.ts src/bot/claim-flow.ts src/bot/create-bot.ts src/bot/one-code.test.ts
git commit -s -m "feat(bot): give each account one code and re-send it" -m "- assign or return the account's code in one immediate transaction
- re-send the same code on any later message and on /mycode"
```

---

### Task 7: Group membership

**Files:**
- Create: `src/core/membership.ts`
- Modify: `src/bot/claim-flow.ts`
- Test: `src/bot/membership.test.ts`

**Interfaces:**
- Produces: `classifyMember(member: ChatMember): 'member' | 'restricted' | 'not_member'`; only `creator`, `administrator` and `member` pass.

- [ ] **Step 1: Write the failing test**

`src/bot/membership.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GROUP_ID, Harness, PASSPHRASE } from '../test/harness.js';
import type { MemberStatus } from '../test/telegram-fake.js';

const ALICE = 5001;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

const triesLeftAfterOneWrong = async (): Promise<string | undefined> => {
  h.telegram.setStatus(GROUP_ID, ALICE, 'member');
  await h.say(ALICE, 'wrong guess');
  return h.lastTextTo(ALICE);
};

describe('group membership', () => {
  test.each<[MemberStatus, string]>([
    ['left', 'This is for members of the Swarm booth group. Join it, then send the passphrase again.'],
    ['kicked', 'This is for members of the Swarm booth group. Join it, then send the passphrase again.'],
    ['restricted', "Finish the group's verification first, then send the passphrase again."],
  ])('%s: refused before the passphrase is checked, and no try is used', async (status, reply) => {
    h.telegram.setStatus(GROUP_ID, ALICE, status);
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe(reply);
    expect(await triesLeftAfterOneWrong()).toBe("That's not it. 4 tries left.");
  });

  test.each<MemberStatus>(['creator', 'administrator', 'member'])('%s: may claim', async (status) => {
    h.telegram.setStatus(GROUP_ID, ALICE, status);
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for Swarm booth:/);
  });

  test('a failed lookup fails closed: no code, and no try used', async () => {
    h.telegram.failNext('getChatMember', { error_code: 400, description: 'Bad Request: member list is inaccessible' });
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe("Couldn't check the group right now. Please try again in a minute.");
    expect(await triesLeftAfterOneWrong()).toBe("That's not it. 4 tries left.");
  });

  test('a claimant who leaves the group keeps the code', async () => {
    await h.say(ALICE, PASSPHRASE);
    h.telegram.setStatus(GROUP_ID, ALICE, 'left');
    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for Swarm booth:/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/bot/membership.test.ts`
Expected: FAIL, 4 tests (`left`, `kicked`, `restricted` and the failed lookup all still get a code).
The four "may claim" and "keeps the code" tests already pass; they guard against over-blocking.

- [ ] **Step 3: Write the rule and add it to the flow**

`src/core/membership.ts`:

```ts
import type { ChatMember } from 'grammy/types';

export type Membership = 'member' | 'restricted' | 'not_member';

/**
 * `restricted` never passes, even with is_member = true: Rose's captcha mutes new members
 * until they solve it, so an unverified account is restricted.
 */
export function classifyMember(member: ChatMember): Membership {
  switch (member.status) {
    case 'creator':
    case 'administrator':
    case 'member':
      return 'member';
    case 'restricted':
      return 'restricted';
    default:
      return 'not_member';
  }
}
```

Replace `src/bot/claim-flow.ts` with:

```ts
import type { Api } from 'grammy';
import { claimOrGet } from '../core/claim.js';
import { classifyMember, type Membership } from '../core/membership.js';
import { verifyPassphrase } from '../core/passphrase.js';
import { errorFields } from '../log.js';
import { recordFailure } from '../store/attempts.js';
import { findCodeByClaimer } from '../store/codes.js';
import { getEvent, type EventRow } from '../store/events.js';
import { plain, type Flow, type Reply } from './flow.js';
import { msg, renderDelivery } from './messages.js';

function codeReply(event: EventRow, code: { privateKey: string; address: string }): Reply {
  return { text: renderDelivery(event.title, event.instructions, code), html: true };
}

export function startReply(flow: Flow, userId: number): string {
  const event = getEvent(flow.db);
  if (!event) return msg.noEventOpen;
  const hasCode = findCodeByClaimer(flow.db, event.id, userId) !== undefined;
  return hasCode ? `${msg.start(event.title)}\n\n${msg.startHasCode}` : msg.start(event.title);
}

export function myCodeReply(flow: Flow, userId: number): Reply {
  const event = getEvent(flow.db);
  const code = event ? findCodeByClaimer(flow.db, event.id, userId) : undefined;
  if (!event || !code) return plain(msg.noCodeYet);
  if (code.privateKey === null) return plain(msg.noLongerStored);
  return codeReply(event, { privateKey: code.privateKey, address: code.address });
}

export interface TextOutcome {
  reply: Reply;
  /** Set when this claim tripped the breaker, so the admin gets told. */
  trippedEvent?: EventRow;
}

/** Any non-command text: the claim flow of spec §8.2, in row order. */
export async function textReply(api: Api, flow: Flow, userId: number, text: string): Promise<TextOutcome> {
  const { db, clock, log } = flow;
  const event = getEvent(db);
  if (!event) return { reply: plain(msg.noEventOpen) };

  const existing = findCodeByClaimer(db, event.id, userId);
  if (existing) {
    if (existing.privateKey === null) return { reply: plain(msg.noLongerStored) };
    return { reply: codeReply(event, { privateKey: existing.privateKey, address: existing.address }) };
  }

  let membership: Membership;
  try {
    membership = classifyMember(await api.getChatMember(event.groupChatId, userId));
  } catch (err) {
    log.warn('membership lookup failed', { user: userId, ...errorFields(err) });
    return { reply: plain(msg.lookupFailed) };
  }
  if (membership === 'not_member') return { reply: plain(msg.notMember(event.title)) };
  if (membership === 'restricted') return { reply: plain(msg.restricted) };

  const right = event.passphraseHash !== null && (await verifyPassphrase(text, event.passphraseHash));
  if (!right) {
    const failures = recordFailure(db, event.id, userId);
    log.info('wrong passphrase', { user: userId, failures });
    return { reply: plain(msg.wrong(event.maxAttempts - failures)) };
  }

  const result = claimOrGet(db, clock.now(), userId);
  switch (result.kind) {
    case 'code':
      if (result.isNew) log.info('claimed', { user: userId, address: result.address });
      return { reply: codeReply(event, result) };
    case 'wiped':
      return { reply: plain(msg.noLongerStored) };
    case 'pool_empty':
      return { reply: plain(msg.allClaimed) };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/bot/membership.test.ts`
Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  57 passed (57)`.

- [ ] **Step 6: Commit**

```bash
git add src/core/membership.ts src/bot/claim-flow.ts src/bot/membership.test.ts
git commit -s -m "feat(bot): require membership of the event group" -m "- check membership live before the passphrase, using no try
- refuse restricted members, so captcha-pending accounts cannot claim
- fail closed when the lookup fails"
```

---

### Task 8: Passphrase tries and lockout

**Files:**
- Create: `src/cli/commands/unlock.ts`
- Modify: `src/store/attempts.ts`, `src/bot/claim-flow.ts`, `src/cli/run-cli.ts`
- Test: `src/bot/lockout.test.ts`

**Interfaces:**
- Produces: `reserveTry(db, eventId, userId, maxAttempts): boolean`, `releaseTry(db, eventId, userId)`, `settleWrong(db, eventId, userId, maxAttempts, now): number`, `resetFailures(db, eventId, userId): boolean`; `recordFailure` is removed.
- Produces: the `dispenser unlock <telegram user id>` command.

A try is reserved in one transaction before the passphrase is hashed, and given back when it was right.
So even concurrent guesses cannot check more than `max_attempts` passphrases.

- [ ] **Step 1: Write the failing test**

`src/bot/lockout.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { key } from '../test/keys.js';
import { textUpdate } from '../test/updates.js';

const ALICE = 5001;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

const guessWrong = async (times: number) => {
  for (let i = 0; i < times; i += 1) await h.say(ALICE, `guess ${i}`);
};

describe('passphrase tries', () => {
  test('counts down, then locks on the 5th wrong try and shows the ID', async () => {
    await guessWrong(4);
    expect(h.telegram.textsTo(ALICE)).toEqual([
      "That's not it. 4 tries left.",
      "That's not it. 3 tries left.",
      "That's not it. 2 tries left.",
      "That's not it. 1 try left.",
    ]);
    await guessWrong(1);
    expect(h.lastTextTo(ALICE)).toBe('Too many wrong tries. Show this to the organizers: ID 5001');
  });

  test('a locked account is refused even with the right passphrase, also after a restart', async () => {
    await guessWrong(5);
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe('Too many wrong tries. Show this to the organizers: ID 5001');
    h.restartBot();
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe('Too many wrong tries. Show this to the organizers: ID 5001');
  });

  test('unlock lets the account try again', async () => {
    await guessWrong(5);
    expect((await h.cli(['unlock', '5001'])).stdout).toBe('unlocked 5001; they can try the passphrase again\n');
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for Swarm booth:/);
  });

  test('unlock refuses an account with no wrong tries', async () => {
    expect((await h.cli(['unlock', '42'])).stderr).toBe('error: no wrong tries recorded for 42\n');
  });

  test('--max-attempts sets the limit', async () => {
    h.close();
    h = new Harness();
    await h.openEvent({ extra: ['--max-attempts', '2'] });
    await guessWrong(1);
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 1 try left.");
    await guessWrong(1);
    expect(h.lastTextTo(ALICE)).toBe('Too many wrong tries. Show this to the organizers: ID 5001');
  });

  test('concurrent guesses cannot exceed the limit: the right one, sent 11th, is refused', async () => {
    const bot = h.bot({ rateLimit: { limit: 1000, windowMs: 2000 } });
    const guesses = [...Array.from({ length: 10 }, (_, i) => `guess ${i}`), PASSPHRASE];
    await Promise.all(guesses.map((text) => bot.handleUpdate(textUpdate(ALICE, text))));
    expect(h.telegram.textsTo(ALICE).some((t) => t.startsWith('Your gift code'))).toBe(false);
  });

  test('text over 200 characters counts as a wrong try', async () => {
    await h.say(ALICE, `${PASSPHRASE}${' '.repeat(200)}x`);
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 4 tries left.");
  });

  test('10-digit Telegram IDs (new accounts) lock out and unlock correctly', async () => {
    const NEW_ACCOUNT = 7_123_456_789;
    for (let i = 0; i < 5; i += 1) await h.say(NEW_ACCOUNT, `guess ${i}`);
    expect(h.lastTextTo(NEW_ACCOUNT)).toBe('Too many wrong tries. Show this to the organizers: ID 7123456789');
    await h.ok(['unlock', '7123456789']);
    await h.say(NEW_ACCOUNT, PASSPHRASE);
    expect(h.lastTextTo(NEW_ACCOUNT)).toMatch(/^Your gift code/);
  });

  test('when no codes are left, any text gets "all claimed" and uses no try', async () => {
    h.close();
    h = new Harness();
    await h.openEvent({ keys: [key(1)] });
    await h.say(5009, PASSPHRASE);
    await h.say(ALICE, 'wrong');
    expect(h.lastTextTo(ALICE)).toBe('All codes have been claimed.');
    await h.importKeys([key(2)]);
    await h.say(ALICE, 'wrong');
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 4 tries left.");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/bot/lockout.test.ts`
Expected: FAIL, 8 tests, for example `expected 'That\'s not it. 0 tries left.' to be 'Too many wrong tries. Show this to th…'`.
"text over 200 characters counts as a wrong try" already passes (Task 3's `verifyPassphrase`); it stays as a guard.

- [ ] **Step 3: Reserve tries atomically**

Replace `src/store/attempts.ts` with:

```ts
import type { Db } from './db.js';

export function failuresOf(db: Db, eventId: number, userId: number): number {
  const row = db
    .prepare('SELECT failures FROM attempts WHERE event_id = ? AND telegram_user_id = ?')
    .get(eventId, userId) as { failures: number } | undefined;
  return row?.failures ?? 0;
}

/**
 * Takes one try if the account has any left. The check and the increment share one
 * transaction, so concurrent guesses can never exceed `maxAttempts`.
 */
export function reserveTry(db: Db, eventId: number, userId: number, maxAttempts: number): boolean {
  return db
    .transaction((): boolean => {
      if (failuresOf(db, eventId, userId) >= maxAttempts) return false;
      db.prepare(
        `INSERT INTO attempts (event_id, telegram_user_id, failures) VALUES (?, ?, 1)
         ON CONFLICT (event_id, telegram_user_id) DO UPDATE SET failures = failures + 1`,
      ).run(eventId, userId);
      return true;
    })
    .immediate();
}

/** Gives back a try that was reserved for a passphrase that turned out right. */
export function releaseTry(db: Db, eventId: number, userId: number): void {
  db.prepare(
    'UPDATE attempts SET failures = failures - 1 WHERE event_id = ? AND telegram_user_id = ? AND failures > 0',
  ).run(eventId, userId);
}

/** Settles a wrong passphrase: sets locked_at the first time failures reach the limit. Returns the failures. */
export function settleWrong(db: Db, eventId: number, userId: number, maxAttempts: number, now: number): number {
  db.prepare(
    `UPDATE attempts SET locked_at = ?
     WHERE event_id = ? AND telegram_user_id = ? AND failures >= ? AND locked_at IS NULL`,
  ).run(now, eventId, userId, maxAttempts);
  return failuresOf(db, eventId, userId);
}

/** Lets a locked-out account try again. locked_at stays, so stats still count the lockout. */
export function resetFailures(db: Db, eventId: number, userId: number): boolean {
  return (
    db.prepare('UPDATE attempts SET failures = 0 WHERE event_id = ? AND telegram_user_id = ?').run(eventId, userId)
      .changes > 0
  );
}
```

Replace `src/bot/claim-flow.ts` with:

```ts
import type { Api } from 'grammy';
import { claimOrGet } from '../core/claim.js';
import { classifyMember, type Membership } from '../core/membership.js';
import { verifyPassphrase } from '../core/passphrase.js';
import { errorFields } from '../log.js';
import { failuresOf, releaseTry, reserveTry, settleWrong } from '../store/attempts.js';
import { countCodes, findCodeByClaimer } from '../store/codes.js';
import { getEvent, type EventRow } from '../store/events.js';
import { plain, type Flow, type Reply } from './flow.js';
import { msg, renderDelivery } from './messages.js';

function codeReply(event: EventRow, code: { privateKey: string; address: string }): Reply {
  return { text: renderDelivery(event.title, event.instructions, code), html: true };
}

export function startReply(flow: Flow, userId: number): string {
  const event = getEvent(flow.db);
  if (!event) return msg.noEventOpen;
  const hasCode = findCodeByClaimer(flow.db, event.id, userId) !== undefined;
  return hasCode ? `${msg.start(event.title)}\n\n${msg.startHasCode}` : msg.start(event.title);
}

export function myCodeReply(flow: Flow, userId: number): Reply {
  const event = getEvent(flow.db);
  const code = event ? findCodeByClaimer(flow.db, event.id, userId) : undefined;
  if (!event || !code) return plain(msg.noCodeYet);
  if (code.privateKey === null) return plain(msg.noLongerStored);
  return codeReply(event, { privateKey: code.privateKey, address: code.address });
}

export interface TextOutcome {
  reply: Reply;
  /** Set when this claim tripped the breaker, so the admin gets told. */
  trippedEvent?: EventRow;
}

/** Any non-command text: the claim flow of spec §8.2, in row order. */
export async function textReply(api: Api, flow: Flow, userId: number, text: string): Promise<TextOutcome> {
  const { db, clock, log } = flow;
  const event = getEvent(db);
  if (!event) return { reply: plain(msg.noEventOpen) };

  const existing = findCodeByClaimer(db, event.id, userId);
  if (existing) {
    if (existing.privateKey === null) return { reply: plain(msg.noLongerStored) };
    return { reply: codeReply(event, { privateKey: existing.privateKey, address: existing.address }) };
  }

  let membership: Membership;
  try {
    membership = classifyMember(await api.getChatMember(event.groupChatId, userId));
  } catch (err) {
    log.warn('membership lookup failed', { user: userId, ...errorFields(err) });
    return { reply: plain(msg.lookupFailed) };
  }
  if (membership === 'not_member') return { reply: plain(msg.notMember(event.title)) };
  if (membership === 'restricted') return { reply: plain(msg.restricted) };

  if (failuresOf(db, event.id, userId) >= event.maxAttempts) return { reply: plain(msg.lockedOut(userId)) };
  if (countCodes(db, event.id).unclaimed === 0) return { reply: plain(msg.allClaimed) };
  if (!reserveTry(db, event.id, userId, event.maxAttempts)) return { reply: plain(msg.lockedOut(userId)) };

  const right = event.passphraseHash !== null && (await verifyPassphrase(text, event.passphraseHash));
  if (!right) {
    const failures = settleWrong(db, event.id, userId, event.maxAttempts, clock.now());
    log.info('wrong passphrase', { user: userId, failures });
    const left = event.maxAttempts - failures;
    return { reply: plain(left > 0 ? msg.wrong(left) : msg.lockedOut(userId)) };
  }
  releaseTry(db, event.id, userId);

  const result = claimOrGet(db, clock.now(), userId);
  switch (result.kind) {
    case 'code':
      if (result.isNew) log.info('claimed', { user: userId, address: result.address });
      return { reply: codeReply(event, result) };
    case 'wiped':
      return { reply: plain(msg.noLongerStored) };
    case 'pool_empty':
      return { reply: plain(msg.allClaimed) };
  }
}
```

- [ ] **Step 4: Add `unlock`**

`src/cli/commands/unlock.ts`:

```ts
import { parseArgs } from 'node:util';
import { resetFailures } from '../../store/attempts.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError, intArg } from '../errors.js';
import { requireEvent } from './event.js';

export function unlock(env: CommandEnv): void {
  const { positionals } = cliArgs(() =>
    parseArgs({ args: env.argv, options: {}, allowPositionals: true, strict: true }),
  );
  if (positionals.length !== 1 || positionals[0] === undefined) throw new CliError('usage: dispenser unlock <telegram user id>');
  const userId = intArg(positionals[0], 'the Telegram user ID', 1, Number.MAX_SAFE_INTEGER);
  const event = requireEvent(env);
  if (!resetFailures(env.db(), event.id, userId)) throw new CliError(`no wrong tries recorded for ${userId}`);
  env.out(`unlocked ${userId}; they can try the passphrase again`);
}
```

In `src/cli/run-cli.ts`, add the import next to the other command imports:

```ts
import { unlock } from './commands/unlock.js';
```

and add to `COMMANDS`:

```ts
  unlock,
```


- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/bot/lockout.test.ts`
Expected: `Tests  9 passed (9)`.

- [ ] **Step 6: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  66 passed (66)`.

- [ ] **Step 7: Commit**

```bash
git add src/store/attempts.ts src/bot/claim-flow.ts src/cli/commands/unlock.ts src/cli/run-cli.ts src/bot/lockout.test.ts
git commit -s -m "feat(bot): lock out an account after five wrong passphrases" -m "- reserve a try atomically before hashing, so concurrent guesses stay capped
- show the account id in the lockout reply
- add dispenser unlock, which keeps the lockout in the stats"
```

---

### Task 9: The event window, edits and passphrase rotation

**Files:**
- Modify: `src/core/claim.ts`, `src/bot/claim-flow.ts`, `src/cli/commands/event.ts`, `src/cli/run-cli.ts`
- Test: `src/bot/window.test.ts`

**Interfaces:**
- Produces: `ClaimResult` gains `closed`; `eventEdit`, `eventPassphrase` and `eventClose` (`dispenser event edit|passphrase|close`).

- [ ] **Step 1: Write the failing test**

`src/bot/window.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { key } from '../test/keys.js';

const ALICE = 5001;
const BOB = 5002;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

describe('the event window', () => {
  test('before --opens nobody can claim', async () => {
    h.clock.set('2026-11-14T09:59:00Z');
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe('No event is open right now.');
    await h.say(ALICE, '/start');
    expect(h.lastTextTo(ALICE)).toBe('No event is open right now.');
  });

  test('at --closes claims stop, but a claimed code is still re-sent', async () => {
    await h.say(ALICE, PASSPHRASE);
    h.clock.set('2026-11-14T18:00:00Z');
    await h.say(BOB, PASSPHRASE);
    expect(h.lastTextTo(BOB)).toBe('No event is open right now.');
    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for Swarm booth:/);
  });

  test('event close stops claims at once and reports the counts', async () => {
    await h.say(ALICE, PASSPHRASE);
    expect((await h.cli(['event', 'close'])).stdout).toBe('closed: 1 claimed, 2 unclaimed. Next: dispenser export\n');
    await h.say(BOB, PASSPHRASE);
    expect(h.lastTextTo(BOB)).toBe('No event is open right now.');
    expect((await h.cli(['event', 'close'])).stderr).toBe('error: the event is already closed\n');
  });

  test('the window follows the event time zone', async () => {
    h.close();
    h = new Harness();
    await h.ok(['init']);
    await h.createEvent(['--tz', 'Europe/Berlin']); // 10:00–18:00 Berlin = 09:00–17:00 UTC in November
    await h.importKeys([key(1)]);
    h.clock.set('2026-11-14T09:30:00Z');
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code/);
    h.clock.set('2026-11-14T17:00:00Z');
    await h.say(BOB, PASSPHRASE);
    expect(h.lastTextTo(BOB)).toBe('No event is open right now.');
  });
});

test('a summer event (CEST, UTC+2) opens at the right instant', async () => {
  h.close();
  h = new Harness();
  h.clock.set('2026-07-01T00:00:00Z');
  await h.ok(['init']);
  await h.createEvent(['--opens', '2026-07-14 10:00', '--closes', '2026-07-14 18:00', '--tz', 'Europe/Berlin']);
  await h.importKeys([key(1)]);
  h.clock.set('2026-07-14T07:59:58Z');
  await h.say(ALICE, PASSPHRASE); // 07:59:59 UTC = 09:59:59 CEST
  expect(h.lastTextTo(ALICE)).toBe('No event is open right now.');
  h.clock.set('2026-07-14T07:59:59Z');
  await h.say(ALICE, PASSPHRASE); // 08:00:00 UTC = 10:00:00 CEST
  expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code/);
});

describe('dispenser event edit', () => {
  test('changes the title and closing time while open', async () => {
    const result = await h.cli(['event', 'edit', '--title', 'Swarm booth day 2', '--closes', '2026-11-14 20:00']);
    expect(result.stdout).toBe('updated title, closesAt\n');
    h.clock.set('2026-11-14T19:00:00Z');
    await h.say(ALICE, '/start');
    expect(h.lastTextTo(ALICE)).toMatch(/^To get your gift code for Swarm booth day 2,/);
  });

  test('--opens can only change before opening', async () => {
    expect((await h.cli(['event', 'edit', '--opens', '2026-11-14 11:00'])).stderr).toBe(
      'error: --opens can only change before the event opens\n',
    );
  });

  test('a closed event cannot change, and nothing is imported after close', async () => {
    await h.ok(['event', 'close']);
    expect((await h.cli(['event', 'edit', '--closes', '2026-11-14 20:00'])).stderr).toBe(
      'error: the event has closed; a closed event cannot change\n',
    );
    expect((await h.cli(['import', '-', '--yes'], { stdin: key(9) })).stderr).toBe(
      'error: the event has closed; import refused\n',
    );
  });

  test('a rotated passphrase replaces the old one at once', async () => {
    h.randomInts = [0, 1, 2];
    const rotated = await h.cli(['event', 'passphrase', '--generate']);
    expect(rotated.stdout).toBe('passphrase replaced; the old one stops working now\npassphrase: acid acorn acre\n');
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 4 tries left.");
    await h.say(ALICE, 'acid acorn acre');
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code for Swarm booth:/);
  });

  test('refuses an edit with no flags', async () => {
    expect((await h.cli(['event', 'edit'])).stderr).toBe('error: nothing to change; pass at least one flag\n');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/bot/window.test.ts`
Expected: FAIL, 10 tests, for example `expected '' to be 'closed: 1 claimed, 2 unclaimed. Next:…'`.

- [ ] **Step 3: Respect the window in the claim**

Replace `src/core/claim.ts` with:

```ts
import { assignNextCode, findCodeByClaimer } from '../store/codes.js';
import type { Db } from '../store/db.js';
import { getEvent } from '../store/events.js';
import { eventState } from './event-state.js';

export type ClaimResult =
  | { kind: 'code'; privateKey: string; address: string; isNew: boolean }
  | { kind: 'wiped' }
  | { kind: 'closed' }
  | { kind: 'pool_empty' };

/**
 * The only function in the bot process that returns a key: the caller's own, at most one.
 * One IMMEDIATE transaction, so concurrent claims from one account all get the same code.
 */
export function claimOrGet(db: Db, now: number, userId: number): ClaimResult {
  return db
    .transaction((): ClaimResult => {
      const event = getEvent(db);
      if (!event) return { kind: 'closed' };
      const existing = findCodeByClaimer(db, event.id, userId);
      if (existing) {
        return existing.privateKey === null
          ? { kind: 'wiped' }
          : { kind: 'code', privateKey: existing.privateKey, address: existing.address, isNew: false };
      }
      if (eventState(event, now) !== 'open') return { kind: 'closed' };
      const code = assignNextCode(db, event.id, userId, now);
      return code ? { kind: 'code', ...code, isNew: true } : { kind: 'pool_empty' };
    })
    .immediate();
}
```

Replace `src/bot/claim-flow.ts` with:

```ts
import type { Api } from 'grammy';
import { claimOrGet } from '../core/claim.js';
import { eventState } from '../core/event-state.js';
import { classifyMember, type Membership } from '../core/membership.js';
import { verifyPassphrase } from '../core/passphrase.js';
import { errorFields } from '../log.js';
import { failuresOf, releaseTry, reserveTry, settleWrong } from '../store/attempts.js';
import { countCodes, findCodeByClaimer } from '../store/codes.js';
import { getEvent, type EventRow } from '../store/events.js';
import { plain, type Flow, type Reply } from './flow.js';
import { msg, renderDelivery } from './messages.js';

function codeReply(event: EventRow, code: { privateKey: string; address: string }): Reply {
  return { text: renderDelivery(event.title, event.instructions, code), html: true };
}

export function startReply(flow: Flow, userId: number): string {
  const event = getEvent(flow.db);
  if (!event || eventState(event, flow.clock.now()) !== 'open') return msg.noEventOpen;
  const hasCode = findCodeByClaimer(flow.db, event.id, userId) !== undefined;
  return hasCode ? `${msg.start(event.title)}\n\n${msg.startHasCode}` : msg.start(event.title);
}

export function myCodeReply(flow: Flow, userId: number): Reply {
  const event = getEvent(flow.db);
  const code = event ? findCodeByClaimer(flow.db, event.id, userId) : undefined;
  if (!event || !code) return plain(msg.noCodeYet);
  if (code.privateKey === null) return plain(msg.noLongerStored);
  return codeReply(event, { privateKey: code.privateKey, address: code.address });
}

export interface TextOutcome {
  reply: Reply;
  /** Set when this claim tripped the breaker, so the admin gets told. */
  trippedEvent?: EventRow;
}

/** Any non-command text: the claim flow of spec §8.2, in row order. */
export async function textReply(api: Api, flow: Flow, userId: number, text: string): Promise<TextOutcome> {
  const { db, clock, log } = flow;
  const event = getEvent(db);
  if (!event) return { reply: plain(msg.noEventOpen) };

  const existing = findCodeByClaimer(db, event.id, userId);
  if (existing) {
    if (existing.privateKey === null) return { reply: plain(msg.noLongerStored) };
    return { reply: codeReply(event, { privateKey: existing.privateKey, address: existing.address }) };
  }
  if (eventState(event, clock.now()) !== 'open') return { reply: plain(msg.noEventOpen) };

  let membership: Membership;
  try {
    membership = classifyMember(await api.getChatMember(event.groupChatId, userId));
  } catch (err) {
    log.warn('membership lookup failed', { user: userId, ...errorFields(err) });
    return { reply: plain(msg.lookupFailed) };
  }
  if (membership === 'not_member') return { reply: plain(msg.notMember(event.title)) };
  if (membership === 'restricted') return { reply: plain(msg.restricted) };

  if (failuresOf(db, event.id, userId) >= event.maxAttempts) return { reply: plain(msg.lockedOut(userId)) };
  if (countCodes(db, event.id).unclaimed === 0) return { reply: plain(msg.allClaimed) };
  if (!reserveTry(db, event.id, userId, event.maxAttempts)) return { reply: plain(msg.lockedOut(userId)) };

  const right = event.passphraseHash !== null && (await verifyPassphrase(text, event.passphraseHash));
  if (!right) {
    const failures = settleWrong(db, event.id, userId, event.maxAttempts, clock.now());
    log.info('wrong passphrase', { user: userId, failures });
    const left = event.maxAttempts - failures;
    return { reply: plain(left > 0 ? msg.wrong(left) : msg.lockedOut(userId)) };
  }
  releaseTry(db, event.id, userId);

  const result = claimOrGet(db, clock.now(), userId);
  switch (result.kind) {
    case 'code':
      if (result.isNew) log.info('claimed', { user: userId, address: result.address });
      return { reply: codeReply(event, result) };
    case 'wiped':
      return { reply: plain(msg.noLongerStored) };
    case 'closed':
      return { reply: plain(msg.noEventOpen) };
    case 'pool_empty':
      return { reply: plain(msg.allClaimed) };
  }
}
```

- [ ] **Step 4: Add edit, passphrase and close**

Replace `src/cli/commands/event.ts` with:

```ts
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { deliveryLength, MAX_MESSAGE_LENGTH } from '../../bot/messages.js';
import { eventState } from '../../core/event-state.js';
import {
  generatePassphrase,
  hashPassphrase,
  MIN_PASSPHRASE_LENGTH,
  normalizePassphrase,
} from '../../core/passphrase.js';
import { countCodes } from '../../store/codes.js';
import { getEvent, insertEvent, updateEvent, type EventPatch, type EventRow } from '../../store/events.js';
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

export async function eventEdit(env: CommandEnv): Promise<void> {
  const { values } = cliArgs(() => parseArgs({ args: env.argv, options: EVENT_OPTIONS, strict: true }));
  const event = requireEvent(env);
  const now = env.deps.clock.now();
  const state = eventState(event, now);
  if (state === 'closed' || state === 'wiped') throw new CliError('the event has closed; a closed event cannot change');

  const patch: EventPatch = {};
  const tz = timeZone(values.tz ?? event.tz);
  if (values.tz !== undefined) patch.tz = tz;
  if (values.title !== undefined) patch.title = required(values.title, '--title');
  if (values.opens !== undefined) {
    if (state !== 'scheduled') throw new CliError('--opens can only change before the event opens');
    patch.opensAt = localTime(values.opens, tz, '--opens');
  }
  if (values.closes !== undefined) {
    patch.closesAt = localTime(values.closes, tz, '--closes');
    if (patch.closesAt <= now) throw new CliError('--closes must be in the future');
  }
  if ((patch.opensAt ?? event.opensAt) >= (patch.closesAt ?? event.closesAt)) {
    throw new CliError('--opens must be before --closes');
  }
  if (values.instructions !== undefined) patch.instructions = await readInstructions(values.instructions);
  checkLength(patch.title ?? event.title, patch.instructions ?? event.instructions);
  if (values['max-attempts'] !== undefined) {
    patch.maxAttempts = intArg(values['max-attempts'], '--max-attempts', 1, 100);
  }
  if (values['trip-rate'] !== undefined) Object.assign(patch, tripRate(values['trip-rate']));
  if (values.group !== undefined) {
    patch.groupChatId = groupId(values.group);
    await requireBotAdmin(env.api(), patch.groupChatId);
  }

  const changed = Object.keys(patch);
  if (changed.length === 0) throw new CliError('nothing to change; pass at least one flag');
  updateEvent(env.db(), event.id, patch);
  env.out(`updated ${changed.join(', ')}`);
}

export async function eventPassphrase(env: CommandEnv): Promise<void> {
  const { values } = cliArgs(() =>
    parseArgs({ args: env.argv, options: { generate: { type: 'boolean' } }, strict: true }),
  );
  const event = requireEvent(env);
  const state = eventState(event, env.deps.clock.now());
  if (state === 'closed' || state === 'wiped') throw new CliError('the event has closed');
  const generated = values.generate === true;
  const passphrase = generated ? generatePassphrase(env.deps.randomInt) : await askPassphrase(env.deps.terminal, '--generate');
  updateEvent(env.db(), event.id, { passphraseHash: await hashPassphrase(passphrase) });
  env.out('passphrase replaced; the old one stops working now');
  if (generated) env.out(`passphrase: ${passphrase}`);
}

export function eventClose(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = requireEvent(env);
  const now = env.deps.clock.now();
  const state = eventState(event, now);
  if (state === 'closed' || state === 'wiped') throw new CliError('the event is already closed');
  updateEvent(env.db(), event.id, { closedAt: now });
  const { claimed, unclaimed } = countCodes(env.db(), event.id);
  env.out(`closed: ${claimed} claimed, ${unclaimed} unclaimed. Next: dispenser export`);
}
```

In `src/cli/run-cli.ts`, replace the line `import { eventCreate } from './commands/event.js';` with:

```ts
import { eventClose, eventCreate, eventEdit, eventPassphrase } from './commands/event.js';
```

and add to `COMMANDS`:

```ts
  'event edit': eventEdit,
  'event passphrase': eventPassphrase,
  'event close': eventClose,
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/bot/window.test.ts`
Expected: `Tests  10 passed (10)`.

- [ ] **Step 6: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  76 passed (76)`.

- [ ] **Step 7: Commit**

```bash
git add src/core/claim.ts src/bot/claim-flow.ts src/cli/commands/event.ts src/cli/run-cli.ts src/bot/window.test.ts
git commit -s -m "feat(bot): honour the event window, with edit, close and rotation" -m "- refuse claims before --opens and from --closes on, still re-sending codes
- add dispenser event edit, event passphrase and event close"
```

---

### Task 10: The claim-burst breaker

**Files:**
- Create: `src/cli/commands/breaker.ts`
- Modify: `src/core/claim.ts`, `src/store/codes.ts`, `src/bot/messages.ts`, `src/bot/claim-flow.ts`, `src/bot/create-bot.ts`, `src/cli/run-cli.ts`
- Test: `src/bot/breaker.test.ts`

**Interfaces:**
- Produces: `ClaimResult` gains `paused` (with `tripped`); `countClaimsSince(db, eventId, since)`; `ordinal(n)`, `tripMessage(event)`; `notifyAdmin(api, flow, text)`; `pause` and `resume` (`dispenser pause|resume [--yes]`).

- [ ] **Step 1: Write the failing test**

`src/bot/breaker.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ADMIN_ID, Harness, PASSPHRASE } from '../test/harness.js';
import { key } from '../test/keys.js';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent({ keys: Array.from({ length: 10 }, (_, i) => key(i + 1)) });
});
afterEach(() => h.close());

const account = (n: number) => 5000 + n;

describe('the claim-burst breaker', () => {
  test('5 claims within 60 s succeed; the 6th trips it, is refused, and the admin is told once', async () => {
    for (let n = 1; n <= 6; n += 1) await h.say(account(n), PASSPHRASE);
    for (let n = 1; n <= 5; n += 1) expect(h.lastTextTo(account(n))).toMatch(/^Your gift code/);
    expect(h.lastTextTo(account(6))).toBe('Claims are paused. Please check back soon.');
    expect(h.telegram.textsTo(ADMIN_ID)).toEqual([
      [
        '🔴 Swarm booth: claims paused',
        'Claim burst: a 6th claim within 60 s (limit 5 per 60 s).',
        'Codes already claimed can still be re-sent.',
        'Check:  dispenser status',
        'Resume: dispenser resume',
      ].join('\n'),
    ]);
    await h.say(account(7), PASSPHRASE);
    expect(h.lastTextTo(account(7))).toBe('Claims are paused. Please check back soon.');
    expect(h.telegram.textsTo(ADMIN_ID)).toHaveLength(1);
  });

  test('re-sends keep working while paused', async () => {
    for (let n = 1; n <= 6; n += 1) await h.say(account(n), PASSPHRASE);
    await h.say(account(1), '/mycode');
    expect(h.lastTextTo(account(1))).toMatch(/^Your gift code/);
  });

  test('claims spread wider than the window never trip it', async () => {
    for (let n = 1; n <= 8; n += 1) {
      h.clock.advance(15_000);
      await h.say(account(n), PASSPHRASE);
    }
    expect(h.lastTextTo(account(8))).toMatch(/^Your gift code/);
  });

  test('resume restarts the window, so the 5 claims that tripped it cannot trip it again', async () => {
    for (let n = 1; n <= 6; n += 1) await h.say(account(n), PASSPHRASE);
    expect((await h.cli(['resume', '--yes'])).stdout).toBe('claims resumed; the burst window starts empty\n');
    await h.say(account(6), PASSPHRASE);
    expect(h.lastTextTo(account(6))).toMatch(/^Your gift code/);
  });

  test('--trip-rate sets the limit', async () => {
    h.close();
    h = new Harness();
    await h.openEvent({ extra: ['--trip-rate', '2/30'] });
    for (let n = 1; n <= 3; n += 1) await h.say(account(n), PASSPHRASE);
    expect(h.lastTextTo(account(3))).toBe('Claims are paused. Please check back soon.');
  });
});

describe('pause and resume by hand', () => {
  test('pause stops claims; resume asks for confirmation without --yes', async () => {
    expect((await h.cli(['pause'])).code).toBe(0);
    await h.say(account(1), PASSPHRASE);
    expect(h.lastTextTo(account(1))).toBe('Claims are paused. Please check back soon.');
    expect((await h.cli(['pause'])).stderr).toBe('error: claims are already paused\n');
    expect((await h.cli(['resume'])).stderr).toBe('error: confirm with --yes, or run it in a terminal\n');
    expect((await h.cli(['resume'], { tty: true, answers: ['n'] })).stderr).toBe('error: not resumed\n');
    expect((await h.cli(['resume'], { tty: true, answers: ['y'] })).code).toBe(0);
    await h.say(account(1), PASSPHRASE);
    expect(h.lastTextTo(account(1))).toMatch(/^Your gift code/);
    expect((await h.cli(['resume', '--yes'])).stderr).toBe('error: claims are not paused\n');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/bot/breaker.test.ts`
Expected: FAIL, 4 tests, for example `expected 'Your gift code for Swarm booth:…' to be 'Claims are paused. Please check back …'`.
"re-sends keep working while paused" and "claims spread wider than the window never trip it" already pass; they guard against a breaker that blocks too much.

- [ ] **Step 3: Trip inside `claimOrGet`**

Append to `src/store/codes.ts`:

```ts
export function countClaimsSince(db: Db, eventId: number, since: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM codes WHERE event_id = ? AND claimed_at >= ?').get(eventId, since) as {
    n: number;
  };
  return row.n;
}
```

Replace `src/core/claim.ts` with:

```ts
import { assignNextCode, countClaimsSince, findCodeByClaimer } from '../store/codes.js';
import type { Db } from '../store/db.js';
import { getEvent, updateEvent } from '../store/events.js';
import { eventState } from './event-state.js';

export type ClaimResult =
  | { kind: 'code'; privateKey: string; address: string; isNew: boolean }
  | { kind: 'wiped' }
  | { kind: 'closed' }
  | { kind: 'paused'; tripped: boolean }
  | { kind: 'pool_empty' };

/**
 * The only function in the bot process that returns a key: the caller's own, at most one.
 * One IMMEDIATE transaction, so concurrent claims from one account all get the same code.
 */
export function claimOrGet(db: Db, now: number, userId: number): ClaimResult {
  return db
    .transaction((): ClaimResult => {
      const event = getEvent(db);
      if (!event) return { kind: 'closed' };
      const existing = findCodeByClaimer(db, event.id, userId);
      if (existing) {
        return existing.privateKey === null
          ? { kind: 'wiped' }
          : { kind: 'code', privateKey: existing.privateKey, address: existing.address, isNew: false };
      }
      if (eventState(event, now) !== 'open') return { kind: 'closed' };
      if (event.pausedAt !== null) return { kind: 'paused', tripped: false };
      const windowStart = Math.max(now - event.tripSeconds * 1000 + 1, event.resumedAt ?? 0);
      if (countClaimsSince(db, event.id, windowStart) >= event.tripCount) {
        updateEvent(db, event.id, { pausedAt: now, pausedReason: 'burst' });
        return { kind: 'paused', tripped: true };
      }
      const code = assignNextCode(db, event.id, userId, now);
      return code ? { kind: 'code', ...code, isNew: true } : { kind: 'pool_empty' };
    })
    .immediate();
}
```

- [ ] **Step 4: Tell the admin**

At the top of `src/bot/messages.ts`, add:

```ts
import type { EventRow } from '../store/events.js';
```

and append:

```ts
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
```

Replace `src/bot/claim-flow.ts` with:

```ts
import type { Api } from 'grammy';
import { claimOrGet } from '../core/claim.js';
import { eventState } from '../core/event-state.js';
import { classifyMember, type Membership } from '../core/membership.js';
import { verifyPassphrase } from '../core/passphrase.js';
import { errorFields } from '../log.js';
import { failuresOf, releaseTry, reserveTry, settleWrong } from '../store/attempts.js';
import { countCodes, findCodeByClaimer } from '../store/codes.js';
import { getEvent, type EventRow } from '../store/events.js';
import { plain, type Flow, type Reply } from './flow.js';
import { msg, renderDelivery } from './messages.js';

function codeReply(event: EventRow, code: { privateKey: string; address: string }): Reply {
  return { text: renderDelivery(event.title, event.instructions, code), html: true };
}

export function startReply(flow: Flow, userId: number): string {
  const event = getEvent(flow.db);
  if (!event || eventState(event, flow.clock.now()) !== 'open') return msg.noEventOpen;
  const hasCode = findCodeByClaimer(flow.db, event.id, userId) !== undefined;
  return hasCode ? `${msg.start(event.title)}\n\n${msg.startHasCode}` : msg.start(event.title);
}

export function myCodeReply(flow: Flow, userId: number): Reply {
  const event = getEvent(flow.db);
  const code = event ? findCodeByClaimer(flow.db, event.id, userId) : undefined;
  if (!event || !code) return plain(msg.noCodeYet);
  if (code.privateKey === null) return plain(msg.noLongerStored);
  return codeReply(event, { privateKey: code.privateKey, address: code.address });
}

export interface TextOutcome {
  reply: Reply;
  /** Set when this claim tripped the breaker, so the admin gets told. */
  trippedEvent?: EventRow;
}

/** Any non-command text: the claim flow of spec §8.2, in row order. */
export async function textReply(api: Api, flow: Flow, userId: number, text: string): Promise<TextOutcome> {
  const { db, clock, log } = flow;
  const event = getEvent(db);
  if (!event) return { reply: plain(msg.noEventOpen) };

  const existing = findCodeByClaimer(db, event.id, userId);
  if (existing) {
    if (existing.privateKey === null) return { reply: plain(msg.noLongerStored) };
    return { reply: codeReply(event, { privateKey: existing.privateKey, address: existing.address }) };
  }
  if (eventState(event, clock.now()) !== 'open') return { reply: plain(msg.noEventOpen) };
  if (event.pausedAt !== null) return { reply: plain(msg.paused) };

  let membership: Membership;
  try {
    membership = classifyMember(await api.getChatMember(event.groupChatId, userId));
  } catch (err) {
    log.warn('membership lookup failed', { user: userId, ...errorFields(err) });
    return { reply: plain(msg.lookupFailed) };
  }
  if (membership === 'not_member') return { reply: plain(msg.notMember(event.title)) };
  if (membership === 'restricted') return { reply: plain(msg.restricted) };

  if (failuresOf(db, event.id, userId) >= event.maxAttempts) return { reply: plain(msg.lockedOut(userId)) };
  if (countCodes(db, event.id).unclaimed === 0) return { reply: plain(msg.allClaimed) };
  if (!reserveTry(db, event.id, userId, event.maxAttempts)) return { reply: plain(msg.lockedOut(userId)) };

  const right = event.passphraseHash !== null && (await verifyPassphrase(text, event.passphraseHash));
  if (!right) {
    const failures = settleWrong(db, event.id, userId, event.maxAttempts, clock.now());
    log.info('wrong passphrase', { user: userId, failures });
    const left = event.maxAttempts - failures;
    return { reply: plain(left > 0 ? msg.wrong(left) : msg.lockedOut(userId)) };
  }
  releaseTry(db, event.id, userId);

  const result = claimOrGet(db, clock.now(), userId);
  switch (result.kind) {
    case 'code':
      if (result.isNew) log.info('claimed', { user: userId, address: result.address });
      return { reply: codeReply(event, result) };
    case 'wiped':
      return { reply: plain(msg.noLongerStored) };
    case 'closed':
      return { reply: plain(msg.noEventOpen) };
    case 'pool_empty':
      return { reply: plain(msg.allClaimed) };
    case 'paused': {
      if (!result.tripped) return { reply: plain(msg.paused) };
      log.warn('breaker tripped', { user: userId });
      const trippedEvent = getEvent(db);
      return trippedEvent ? { reply: plain(msg.paused), trippedEvent } : { reply: plain(msg.paused) };
    }
  }
}

/** Admin messages are plain text, so a group title cannot inject formatting. Failures are only logged. */
export async function notifyAdmin(api: Api, flow: Flow, text: string): Promise<void> {
  try {
    await api.sendMessage(flow.adminUserId, text);
  } catch (err) {
    flow.log.error('admin message failed', errorFields(err));
  }
}
```

Replace `src/bot/create-bot.ts` with:

```ts
import { Bot, BotError, type Context, type Middleware, type Transformer } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { Clock } from '../clock.js';
import { errorFields, type Logger } from '../log.js';
import { openDatabase } from '../store/db.js';
import { myCodeReply, notifyAdmin, startReply, textReply } from './claim-flow.js';
import type { Flow, Reply } from './flow.js';
import { msg, tripMessage } from './messages.js';
import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimit } from './rate-limit.js';

export interface BotDeps {
  token: string;
  botInfo: UserFromGetMe;
  dataDir: string;
  adminUserId: number;
  clock: Clock;
  log: Logger;
  /** Installed on the API client, e.g. auto-retry in production or the Telegram fake in tests. */
  transformers?: Transformer[];
  /** Installed ahead of every handler, e.g. the runner's sequentialize in production. */
  before?: Middleware<Context>[];
  rateLimit?: RateLimit;
}

export interface DispenserBot {
  bot: Bot;
  /** Handles one update the way the runner does: errors go to the bot's error handler. */
  handleUpdate(update: Update): Promise<void>;
  close(): void;
}

function updateType(update: Update): string {
  return Object.keys(update).find((key) => key !== 'update_id') ?? 'unknown';
}

export function createBot(deps: BotDeps): DispenserBot {
  const db = openDatabase(deps.dataDir);
  const bot = new Bot(deps.token, { botInfo: deps.botInfo });
  for (const transformer of deps.transformers ?? []) bot.api.config.use(transformer);
  for (const middleware of deps.before ?? []) bot.use(middleware);

  const flow: Flow = { db, clock: deps.clock, log: deps.log, adminUserId: deps.adminUserId, botId: deps.botInfo.id };
  const allow = createRateLimiter(deps.clock, deps.rateLimit ?? DEFAULT_RATE_LIMIT);
  const options = (reply: Reply) => (reply.html ? { parse_mode: 'HTML' as const } : {});

  const priv = bot.chatType('private');
  priv.use(async (ctx, next) => {
    if (allow(ctx.from.id)) await next();
  });
  priv.command('start', (ctx) => ctx.reply(startReply(flow, ctx.from.id)));
  priv.command('mycode', async (ctx) => {
    const reply = myCodeReply(flow, ctx.from.id);
    await ctx.reply(reply.text, options(reply));
  });
  priv.on('message:text', async (ctx) => {
    let outcome;
    try {
      outcome = await textReply(ctx.api, flow, ctx.from.id, ctx.message.text);
    } catch (err) {
      flow.log.error('claim flow failed', { user: ctx.from.id, ...errorFields(err) });
      await ctx.reply(msg.somethingWrong);
      return;
    }
    try {
      await ctx.reply(outcome.reply.text, options(outcome.reply));
    } finally {
      if (outcome.trippedEvent) await notifyAdmin(ctx.api, flow, tripMessage(outcome.trippedEvent));
    }
  });

  bot.catch((err) => {
    deps.log.error('update failed', {
      updateId: err.ctx.update.update_id,
      updateType: updateType(err.ctx.update),
      ...errorFields(err.error),
    });
  });

  return {
    bot,
    async handleUpdate(update) {
      try {
        await bot.handleUpdate(update);
      } catch (err) {
        if (!(err instanceof BotError)) throw err;
        await bot.errorHandler(err);
      }
    },
    close: () => db.close(),
  };
}
```

- [ ] **Step 5: Add pause and resume**

`src/cli/commands/breaker.ts`:

```ts
import { parseArgs } from 'node:util';
import { updateEvent } from '../../store/events.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError } from '../errors.js';
import { requireEvent } from './event.js';

export function pause(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = requireEvent(env);
  if (event.wipedAt !== null) throw new CliError('the event is wiped');
  if (event.pausedAt !== null) throw new CliError('claims are already paused');
  updateEvent(env.db(), event.id, { pausedAt: env.deps.clock.now(), pausedReason: 'manual' });
  env.out('claims paused; re-sends of claimed codes keep working. Resume with: dispenser resume');
}

export async function resume(env: CommandEnv): Promise<void> {
  const { values } = cliArgs(() => parseArgs({ args: env.argv, options: { yes: { type: 'boolean' } }, strict: true }));
  const event = requireEvent(env);
  if (event.pausedAt === null) throw new CliError('claims are not paused');
  const reason = event.pausedReason === 'burst' ? 'a claim burst tripped the breaker' : 'paused by hand';
  if (values.yes !== true) {
    if (!env.deps.terminal.isTTY) throw new CliError('confirm with --yes, or run it in a terminal');
    const answer = await env.deps.terminal.ask(`Claims are paused (${reason}). Resume? [y/N] `, { hidden: false });
    if (answer.trim().toLowerCase() !== 'y') throw new CliError('not resumed');
  }
  updateEvent(env.db(), event.id, { pausedAt: null, pausedReason: null, resumedAt: env.deps.clock.now() });
  env.out('claims resumed; the burst window starts empty');
}
```

In `src/cli/run-cli.ts`, add the import next to the other command imports:

```ts
import { pause, resume } from './commands/breaker.js';
```

and add to `COMMANDS`:

```ts
  pause,
  resume,
```


- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/bot/breaker.test.ts`
Expected: `Tests  6 passed (6)`.

- [ ] **Step 7: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  82 passed (82)`.

- [ ] **Step 8: Commit**

```bash
git add src/core/claim.ts src/store/codes.ts src/bot/messages.ts src/bot/claim-flow.ts src/bot/create-bot.ts src/cli/commands/breaker.ts src/cli/run-cli.ts src/bot/breaker.test.ts
git commit -s -m "feat(bot): pause claims on a claim burst" -m "- refuse the claim that would exceed the limit and pause the event
- send the admin one message per trip
- add dispenser pause and resume; resume restarts the window"
```

---

### Task 11: `status` shows what judging a trip needs

**Files:**
- Modify: `src/store/codes.ts`, `src/store/attempts.ts`, `src/cli/commands/status.ts`
- Test: `src/cli/status.test.ts`

**Interfaces:**
- Produces: `recentClaims(db, eventId, limit)`, `lockedOutAccounts(db, eventId, maxAttempts): number[]`.

- [ ] **Step 1: Write the failing test**

`src/cli/status.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { BOT_ID, GROUP_ID, Harness, PASSPHRASE } from '../test/harness.js';
import { key } from '../test/keys.js';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent({ keys: Array.from({ length: 10 }, (_, i) => key(i + 1)) });
});
afterEach(() => h.close());

describe('dispenser status', () => {
  test('shows claims, the breaker, the group, lockouts and recent claims', async () => {
    for (let i = 0; i < 5; i += 1) await h.say(4242, `guess ${i}`); // 10:00:01–05
    for (let n = 1; n <= 6; n += 1) await h.say(5000 + n, PASSPHRASE); // 10:00:06–11; the 6th trips
    expect((await h.cli(['status'])).stdout).toBe(
      [
        'Event     Swarm booth · OPEN · closes 2026-11-14 18:00 UTC',
        'Claims    5 claimed · 5 left · last claim 10:00:10',
        'Breaker   PAUSED since 10:00:11 · claim burst: a 6th claim within 60 s (limit 5 per 60 s)',
        'Group     -1001234567890 “Swarm booth chat” · bot is an admin (checked live)',
        'Lockouts  1 · 4242',
        'Recent    10:00:10  5005  0xe1AB…b276',
        '          10:00:09  5004  0x1efF…A718',
        '          10:00:08  5003  0x6813…BA69',
        '          10:00:07  5002  0x2B5A…D6cF',
        '          10:00:06  5001  0x7E5F…5Bdf',
        '',
      ].join('\n'),
    );
  });

  test('says when the bot lost admin, or Telegram cannot be reached', async () => {
    h.telegram.setStatus(GROUP_ID, BOT_ID, 'member');
    expect((await h.cli(['status'])).stdout).toMatch(/^Group     .*bot is NOT an admin \(status member\); claims fail closed$/m);
    h.telegram.failNext('getMe', new Error('network down'));
    expect((await h.cli(['status'])).stdout).toMatch(
      /^Group     -1001234567890 · lookup failed \(no answer from Telegram\); claims fail closed$/m,
    );
  });

  test('names the reason when the group was upgraded to a supergroup, so the admin can switch IDs', async () => {
    h.telegram.failNext('getChat', { error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat' });
    expect((await h.cli(['status'])).stdout).toMatch(
      /^Group     -1001234567890 · lookup failed \(400: Bad Request: group chat was upgraded to a supergroup chat\); claims fail closed$/m,
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/cli/status.test.ts`
Expected: FAIL, 3 tests; status prints only the Event and Claims lines so far.

- [ ] **Step 3: Implement**

Append to `src/store/codes.ts`:

```ts
export function recentClaims(
  db: Db,
  eventId: number,
  limit: number,
): Array<{ claimedBy: number; claimedAt: number; address: string }> {
  return db
    .prepare(
      `SELECT claimed_by AS claimedBy, claimed_at AS claimedAt, address FROM codes
       WHERE event_id = ? AND claimed_by IS NOT NULL ORDER BY claimed_at DESC, id DESC LIMIT ?`,
    )
    .all(eventId, limit) as Array<{ claimedBy: number; claimedAt: number; address: string }>;
}
```

Append to `src/store/attempts.ts`:

```ts
export function lockedOutAccounts(db: Db, eventId: number, maxAttempts: number): number[] {
  return (
    db
      .prepare(
        'SELECT telegram_user_id AS id FROM attempts WHERE event_id = ? AND failures >= ? ORDER BY telegram_user_id',
      )
      .all(eventId, maxAttempts) as Array<{ id: number }>
  ).map((row) => row.id);
}
```

Replace `src/cli/commands/status.ts` with:

```ts
import { GrammyError } from 'grammy';
import { parseArgs } from 'node:util';
import { ordinal } from '../../bot/messages.js';
import { eventState } from '../../core/event-state.js';
import { lockedOutAccounts } from '../../store/attempts.js';
import { countCodes, recentClaims } from '../../store/codes.js';
import { getEvent, type EventRow } from '../../store/events.js';
import { formatDateTime, formatTime } from '../../time.js';
import type { CommandEnv } from '../env.js';
import { cliArgs } from '../errors.js';
import { checkGroup } from '../group.js';

const label = (name: string): string => name.padEnd(10);
const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

function stateLine(event: EventRow, now: number): string {
  const state = eventState(event, now);
  switch (state) {
    case 'scheduled':
      return `SCHEDULED · opens ${formatDateTime(event.opensAt, event.tz)}`;
    case 'open':
      return `OPEN · closes ${formatDateTime(event.closesAt, event.tz)}`;
    case 'closed':
      return event.exportedAt === null ? 'CLOSED · next: dispenser export' : 'CLOSED · exported · next: dispenser wipe';
    case 'wiped':
      return 'WIPED';
  }
}

function breakerLine(event: EventRow): string {
  if (event.pausedAt === null) return 'clear';
  const since = `PAUSED since ${formatTime(event.pausedAt, event.tz)}`;
  if (event.pausedReason === 'manual') return `${since} · paused by hand`;
  return `${since} · claim burst: a ${ordinal(event.tripCount + 1)} claim within ${event.tripSeconds} s (limit ${event.tripCount} per ${event.tripSeconds} s)`;
}

async function groupLine(env: CommandEnv, event: EventRow): Promise<string> {
  try {
    const group = await checkGroup(env.api(), event.groupChatId);
    const verdict =
      group.botStatus === 'administrator'
        ? 'bot is an admin (checked live)'
        : `bot is NOT an admin (status ${group.botStatus}); claims fail closed`;
    return `${event.groupChatId} “${group.title}” · ${verdict}`;
  } catch (err) {
    const why = err instanceof GrammyError ? `${err.error_code}: ${err.description}` : 'no answer from Telegram';
    return `${event.groupChatId} · lookup failed (${why}); claims fail closed`;
  }
}

export async function status(env: CommandEnv): Promise<void> {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const db = env.db();
  const event = getEvent(db);
  if (!event) {
    env.out('No event yet. Create one with "dispenser event create".');
    return;
  }
  const now = env.deps.clock.now();
  const { claimed, unclaimed } = countCodes(db, event.id);
  const recent = recentClaims(db, event.id, 10);
  const lastClaim = recent[0] ? ` · last claim ${formatTime(recent[0].claimedAt, event.tz)}` : '';
  const locked = lockedOutAccounts(db, event.id, event.maxAttempts);

  env.out(`${label('Event')}${event.title} · ${stateLine(event, now)}`);
  env.out(`${label('Claims')}${claimed} claimed · ${unclaimed} left${lastClaim}`);
  env.out(`${label('Breaker')}${breakerLine(event)}`);
  env.out(`${label('Group')}${await groupLine(env, event)}`);
  env.out(`${label('Lockouts')}${locked.length}${locked.length > 0 ? ` · ${locked.join(', ')}` : ''}`);
  recent.forEach((claim, i) => {
    env.out(`${label(i === 0 ? 'Recent' : '')}${formatTime(claim.claimedAt, event.tz)}  ${claim.claimedBy}  ${short(claim.address)}`);
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/cli/status.test.ts`
Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  85 passed (85)`.

- [ ] **Step 6: Commit**

```bash
git add src/store/codes.ts src/store/attempts.ts src/cli/commands/status.ts src/cli/status.test.ts
git commit -s -m "feat(cli): show the breaker, group, lockouts and recent claims in status" -m "- check the group live and name telegram's reason when it fails
- list the last 10 claims with time, account and address"
```

---

### Task 12: Input rules

**Files:**
- Modify: `src/bot/create-bot.ts`
- Test: `src/bot/input.test.ts`

- [ ] **Step 1: Write the failing test**

`src/bot/input.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { GROUP_ID, Harness, PASSPHRASE } from '../test/harness.js';
import { callbackUpdate, locationUpdate, supergroup, textUpdate } from '../test/updates.js';

const ALICE = 5001;
const START = "To get your gift code for Swarm booth, join the event's Telegram group, then send me the passphrase you were given.";

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

describe('input rules', () => {
  test('messages in groups get no reply, even the passphrase', async () => {
    await h.send(textUpdate(ALICE, PASSPHRASE, supergroup(GROUP_ID, 'Swarm booth chat')));
    await h.send(textUpdate(ALICE, '/start', supergroup(GROUP_ID, 'Swarm booth chat')));
    expect(h.telegram.sent).toEqual([]);
  });

  test('other commands and non-text messages get the /start reply and use no try', async () => {
    await h.say(ALICE, '/help');
    await h.send(locationUpdate(ALICE));
    expect(h.telegram.textsTo(ALICE)).toEqual([START, START]);
    await h.say(ALICE, 'wrong');
    expect(h.lastTextTo(ALICE)).toBe("That's not it. 4 tries left.");
  });

  test('malformed or unknown button data gets an empty answer and nothing else', async () => {
    await h.say(ALICE, PASSPHRASE);
    const before = h.telegram.sent.length;
    for (const data of ['ev:1', 'ci:uploaded ', 'ci:', 'ci:deleted', 'x'.repeat(64)]) await h.tap(ALICE, data);
    await h.send(callbackUpdate(ALICE, 'ci:uploaded', supergroup(GROUP_ID, 'Swarm booth chat')));
    expect(h.telegram.callbackAnswers.map((a) => a.text)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(h.telegram.sent.length).toBe(before);
  });


  test('a network failure during the lookup fails closed too', async () => {
    h.telegram.failNext('getChatMember', new Error('socket hang up'));
    await h.say(ALICE, PASSPHRASE);
    expect(h.lastTextTo(ALICE)).toBe("Couldn't check the group right now. Please try again in a minute.");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/bot/input.test.ts`
Expected: FAIL, 2 tests: `/help` is still read as a passphrase, and button taps get no answer at all.
The group-silence and lookup-failure tests already pass; they guard rules that earlier tasks put in place.

- [ ] **Step 3: Implement**

Replace `src/bot/create-bot.ts` with:

```ts
import { Bot, BotError, type Context, type Middleware, type Transformer } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { Clock } from '../clock.js';
import { errorFields, type Logger } from '../log.js';
import { openDatabase } from '../store/db.js';
import { myCodeReply, notifyAdmin, startReply, textReply } from './claim-flow.js';
import type { Flow, Reply } from './flow.js';
import { msg, tripMessage } from './messages.js';
import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimit } from './rate-limit.js';

export interface BotDeps {
  token: string;
  botInfo: UserFromGetMe;
  dataDir: string;
  adminUserId: number;
  clock: Clock;
  log: Logger;
  /** Installed on the API client, e.g. auto-retry in production or the Telegram fake in tests. */
  transformers?: Transformer[];
  /** Installed ahead of every handler, e.g. the runner's sequentialize in production. */
  before?: Middleware<Context>[];
  rateLimit?: RateLimit;
}

export interface DispenserBot {
  bot: Bot;
  /** Handles one update the way the runner does: errors go to the bot's error handler. */
  handleUpdate(update: Update): Promise<void>;
  close(): void;
}

function updateType(update: Update): string {
  return Object.keys(update).find((key) => key !== 'update_id') ?? 'unknown';
}

export function createBot(deps: BotDeps): DispenserBot {
  const db = openDatabase(deps.dataDir);
  const bot = new Bot(deps.token, { botInfo: deps.botInfo });
  for (const transformer of deps.transformers ?? []) bot.api.config.use(transformer);
  for (const middleware of deps.before ?? []) bot.use(middleware);

  const flow: Flow = { db, clock: deps.clock, log: deps.log, adminUserId: deps.adminUserId, botId: deps.botInfo.id };
  const allow = createRateLimiter(deps.clock, deps.rateLimit ?? DEFAULT_RATE_LIMIT);
  const options = (reply: Reply) => (reply.html ? { parse_mode: 'HTML' as const } : {});

  const priv = bot.chatType('private');
  priv.use(async (ctx, next) => {
    if (allow(ctx.from.id)) await next();
  });
  priv.command('start', (ctx) => ctx.reply(startReply(flow, ctx.from.id)));
  priv.command('mycode', async (ctx) => {
    const reply = myCodeReply(flow, ctx.from.id);
    await ctx.reply(reply.text, options(reply));
  });
  priv.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply(startReply(flow, ctx.from.id));
      return;
    }
    let outcome;
    try {
      outcome = await textReply(ctx.api, flow, ctx.from.id, ctx.message.text);
    } catch (err) {
      flow.log.error('claim flow failed', { user: ctx.from.id, ...errorFields(err) });
      await ctx.reply(msg.somethingWrong);
      return;
    }
    try {
      await ctx.reply(outcome.reply.text, options(outcome.reply));
    } finally {
      if (outcome.trippedEvent) await notifyAdmin(ctx.api, flow, tripMessage(outcome.trippedEvent));
    }
  });
  priv.on('message', (ctx) => ctx.reply(startReply(flow, ctx.from.id)));
  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery());

  bot.catch((err) => {
    deps.log.error('update failed', {
      updateId: err.ctx.update.update_id,
      updateType: updateType(err.ctx.update),
      ...errorFields(err.error),
    });
  });

  return {
    bot,
    async handleUpdate(update) {
      try {
        await bot.handleUpdate(update);
      } catch (err) {
        if (!(err instanceof BotError)) throw err;
        await bot.errorHandler(err);
      }
    },
    close: () => db.close(),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/bot/input.test.ts`
Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  89 passed (89)`.

- [ ] **Step 6: Commit**

```bash
git add src/bot/create-bot.ts src/bot/input.test.ts
git commit -s -m "feat(bot): answer other commands and buttons without using a try" -m "- reply to other commands and non-text messages with the start text
- answer unknown or malformed button data with nothing"
```

---

### Task 13: Group setup

**Files:**
- Create: `src/bot/group-status.ts`
- Modify: `src/bot/create-bot.ts`
- Test: `src/bot/group-status.test.ts`

**Interfaces:**
- Consumes: `notifyAdmin` (Task 10), `getEvent` (Task 2).
- Produces: `handleGroupStatus(api, flow, update: ChatMemberUpdated)`, wired to `my_chat_member` updates.

- [ ] **Step 1: Write the failing test**

`src/bot/group-status.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ADMIN_ID, BOT_ID, GROUP_ID, Harness } from '../test/harness.js';
import type { MemberStatus } from '../test/telegram-fake.js';
import { botStatusUpdate, supergroup } from '../test/updates.js';

const OTHER_GROUP = -1009999999999;
const STRANGER = 6666;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

const change = (chatId: number, title: string, by: number, from: MemberStatus, to: MemberStatus) =>
  h.send(botStatusUpdate({ chat: supergroup(chatId, title), by, botId: BOT_ID, from, to }));

describe('the bot added to or changed in a group', () => {
  test('promoted by the admin: tells the admin the chat ID and how to use it', async () => {
    await change(OTHER_GROUP, 'New event chat', ADMIN_ID, 'member', 'administrator');
    expect(h.telegram.textsTo(ADMIN_ID)).toEqual([
      "I'm now an admin in “New event chat” (ID -1009999999999).\nUse it as: dispenser event create --group=-1009999999999 …",
    ]);
  });

  test('added as a member by the admin: asks to be made an admin', async () => {
    await change(OTHER_GROUP, 'New event chat', ADMIN_ID, 'left', 'member');
    expect(h.lastTextTo(ADMIN_ID)).toBe(
      "I'm now a member of “New event chat” (ID -1009999999999). Make me an admin so I can check membership.",
    );
  });

  test('added by anyone else: leaves without a word and tells no one', async () => {
    await change(OTHER_GROUP, 'Look-alike chat', STRANGER, 'left', 'member');
    expect(h.telegram.leftChats).toEqual([OTHER_GROUP]);
    expect(h.telegram.sent).toEqual([]);
  });

  test('demoted in the event group by someone else: warns the admin that claims fail', async () => {
    await change(GROUP_ID, 'Swarm booth chat', STRANGER, 'administrator', 'member');
    expect(h.lastTextTo(ADMIN_ID)).toBe(
      'My status in “Swarm booth chat” (ID -1001234567890) is now member.\n' +
        'The group check fails, and nobody can claim, until you make me an admin again.',
    );
  });

  test('demoted in the event group by the admin: one message, with the warning appended', async () => {
    await change(GROUP_ID, 'Swarm booth chat', ADMIN_ID, 'administrator', 'member');
    expect(h.telegram.textsTo(ADMIN_ID)).toEqual([
      "I'm now a member of “Swarm booth chat” (ID -1001234567890). Make me an admin so I can check membership.\n" +
        'The group check fails, and nobody can claim, until you make me an admin again.',
    ]);
  });

  test("ignores the update caused by the bot's own leaving", async () => {
    await change(OTHER_GROUP, 'Look-alike chat', BOT_ID, 'member', 'left');
    expect(h.telegram.sent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/bot/group-status.test.ts`
Expected: FAIL, 5 tests, for example `expected [] to deeply equal [ -1009999999999 ]`.
"ignores the update caused by the bot's own leaving" already passes, since nothing handles these updates yet.

- [ ] **Step 3: Implement**

`src/bot/group-status.ts`:

```ts
import type { Api } from 'grammy';
import type { ChatMember, ChatMemberUpdated } from 'grammy/types';
import { getEvent } from '../store/events.js';
import { notifyAdmin } from './claim-flow.js';
import type { Flow } from './flow.js';

const present = (status: ChatMember['status']): boolean => status === 'member' || status === 'administrator';

/** Spec §6.4: report the group ID to the admin; leave any group someone else added the bot to. */
export async function handleGroupStatus(api: Api, flow: Flow, update: ChatMemberUpdated): Promise<void> {
  const { chat, from } = update;
  if (chat.type !== 'group' && chat.type !== 'supergroup') return;
  if (from.id === flow.botId) return;

  const before = update.old_chat_member.status;
  const after = update.new_chat_member.status;
  const byAdmin = from.id === flow.adminUserId;
  const isEventGroup = getEvent(flow.db)?.groupChatId === chat.id;
  const addedByOther = !byAdmin && !present(before) && present(after);
  const lines: string[] = [];

  if (addedByOther) {
    flow.log.warn('added to a group by someone else; leaving', { chat: chat.id, by: from.id });
    await api.leaveChat(chat.id);
    if (!isEventGroup) return;
    lines.push(`Someone else added me to “${chat.title}” (ID ${chat.id}), so I left. Add me yourself.`);
  } else if (byAdmin && after === 'administrator') {
    lines.push(`I'm now an admin in “${chat.title}” (ID ${chat.id}).`, `Use it as: dispenser event create --group=${chat.id} …`);
  } else if (byAdmin && after === 'member') {
    lines.push(`I'm now a member of “${chat.title}” (ID ${chat.id}). Make me an admin so I can check membership.`);
  } else if (isEventGroup) {
    lines.push(`My status in “${chat.title}” (ID ${chat.id}) is now ${after}.`);
  } else {
    return;
  }

  const adminAfter = after === 'administrator' && !addedByOther;
  if (isEventGroup && !adminAfter) {
    lines.push('The group check fails, and nobody can claim, until you make me an admin again.');
  }
  await notifyAdmin(api, flow, lines.join('\n'));
}
```

Replace `src/bot/create-bot.ts` with:

```ts
import { Bot, BotError, type Context, type Middleware, type Transformer } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { Clock } from '../clock.js';
import { errorFields, type Logger } from '../log.js';
import { openDatabase } from '../store/db.js';
import { myCodeReply, notifyAdmin, startReply, textReply } from './claim-flow.js';
import type { Flow, Reply } from './flow.js';
import { handleGroupStatus } from './group-status.js';
import { msg, tripMessage } from './messages.js';
import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimit } from './rate-limit.js';

export interface BotDeps {
  token: string;
  botInfo: UserFromGetMe;
  dataDir: string;
  adminUserId: number;
  clock: Clock;
  log: Logger;
  /** Installed on the API client, e.g. auto-retry in production or the Telegram fake in tests. */
  transformers?: Transformer[];
  /** Installed ahead of every handler, e.g. the runner's sequentialize in production. */
  before?: Middleware<Context>[];
  rateLimit?: RateLimit;
}

export interface DispenserBot {
  bot: Bot;
  /** Handles one update the way the runner does: errors go to the bot's error handler. */
  handleUpdate(update: Update): Promise<void>;
  close(): void;
}

function updateType(update: Update): string {
  return Object.keys(update).find((key) => key !== 'update_id') ?? 'unknown';
}

export function createBot(deps: BotDeps): DispenserBot {
  const db = openDatabase(deps.dataDir);
  const bot = new Bot(deps.token, { botInfo: deps.botInfo });
  for (const transformer of deps.transformers ?? []) bot.api.config.use(transformer);
  for (const middleware of deps.before ?? []) bot.use(middleware);

  const flow: Flow = { db, clock: deps.clock, log: deps.log, adminUserId: deps.adminUserId, botId: deps.botInfo.id };
  const allow = createRateLimiter(deps.clock, deps.rateLimit ?? DEFAULT_RATE_LIMIT);
  const options = (reply: Reply) => (reply.html ? { parse_mode: 'HTML' as const } : {});

  bot.on('my_chat_member', (ctx) => handleGroupStatus(ctx.api, flow, ctx.myChatMember));

  const priv = bot.chatType('private');
  priv.use(async (ctx, next) => {
    if (allow(ctx.from.id)) await next();
  });
  priv.command('start', (ctx) => ctx.reply(startReply(flow, ctx.from.id)));
  priv.command('mycode', async (ctx) => {
    const reply = myCodeReply(flow, ctx.from.id);
    await ctx.reply(reply.text, options(reply));
  });
  priv.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply(startReply(flow, ctx.from.id));
      return;
    }
    let outcome;
    try {
      outcome = await textReply(ctx.api, flow, ctx.from.id, ctx.message.text);
    } catch (err) {
      flow.log.error('claim flow failed', { user: ctx.from.id, ...errorFields(err) });
      await ctx.reply(msg.somethingWrong);
      return;
    }
    try {
      await ctx.reply(outcome.reply.text, options(outcome.reply));
    } finally {
      if (outcome.trippedEvent) await notifyAdmin(ctx.api, flow, tripMessage(outcome.trippedEvent));
    }
  });
  priv.on('message', (ctx) => ctx.reply(startReply(flow, ctx.from.id)));
  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery());

  bot.catch((err) => {
    deps.log.error('update failed', {
      updateId: err.ctx.update.update_id,
      updateType: updateType(err.ctx.update),
      ...errorFields(err.error),
    });
  });

  return {
    bot,
    async handleUpdate(update) {
      try {
        await bot.handleUpdate(update);
      } catch (err) {
        if (!(err instanceof BotError)) throw err;
        await bot.errorHandler(err);
      }
    },
    close: () => db.close(),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/bot/group-status.test.ts`
Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  95 passed (95)`.

- [ ] **Step 6: Commit**

```bash
git add src/bot/group-status.ts src/bot/create-bot.ts src/bot/group-status.test.ts
git commit -s -m "feat(bot): report group ids to the admin and leave foreign groups" -m "- message the admin the chat id and the --group= form
- leave any group someone else added the bot to
- warn the admin when the bot is no longer an admin in the event group"
```

---

### Task 14: Export and wipe

**Files:**
- Create: `src/store/bulk.ts`, `src/cli/commands/export-wipe.ts`
- Modify: `src/store/codes.ts`, `src/cli/run-cli.ts`
- Test: `src/cli/export-wipe.test.ts`

**Interfaces:**
- Produces: `unclaimedKeys(db, eventId)`, `wipeKeys(db, eventId, now): number`, `compactDatabase(db): boolean` in `src/store/bulk.ts` (CLI only); `unclaimedAddresses(db, eventId)`; `exportCodes` and `wipe` (`dispenser export`, `dispenser wipe --checksum <sum>`).

- [ ] **Step 1: Write the failing test**

`src/cli/export-wipe.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { key } from '../test/keys.js';

const ALICE = 5001;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
  await h.say(ALICE, PASSPHRASE); // claims key(1)
});
afterEach(() => h.close());

const checksumOf = (stderr: string): string => /^checksum: ([0-9a-f]{16}) \(\d+ codes\)$/m.exec(stderr)?.[1] ?? '';

describe('dispenser export', () => {
  test('refuses while the event is open', async () => {
    expect((await h.cli(['export'])).stderr).toBe(
      'error: the event is still open; close it first with "dispenser event close"\n',
    );
  });

  test('writes exactly the unclaimed keys to stdout, and the checksum to stderr', async () => {
    await h.ok(['event', 'close']);
    const result = await h.cli(['export']);
    expect(result.stdout).toBe(`${key(2)}\n${key(3)}\n`);
    expect(result.stderr).toMatch(/^checksum: [0-9a-f]{16} \(2 codes\)\n$/);
  });
});

describe('dispenser wipe', () => {
  test('refuses before an export, and with a wrong checksum, deleting nothing', async () => {
    await h.ok(['event', 'close']);
    expect((await h.cli(['wipe', '--checksum', '0123456789abcdef'])).stderr).toBe(
      'error: run "dispenser export" first, and keep its output\n',
    );
    await h.ok(['export']);
    expect((await h.cli(['wipe', '--checksum', '0123456789abcdef'])).stderr).toBe(
      'error: the checksum does not match the last export; nothing was deleted\n',
    );
    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toMatch(/^Your gift code/);
  });

  test('deletes every key from the database files, keeps the claim log, and can run again', async () => {
    await h.ok(['event', 'close']);
    const sum = checksumOf((await h.ok(['export'])).stderr);
    expect((await h.cli(['wipe', '--checksum', sum])).stdout).toBe('wiped 3 keys; the claim log is kept\n');

    const bytes = readdirSync(h.dataDir)
      .filter((f) => f.startsWith('dispenser.db'))
      .map((f) => readFileSync(join(h.dataDir, f)).toString('latin1'))
      .join('');
    for (const n of [1, 2, 3]) expect(bytes).not.toContain(key(n).slice(2));

    await h.say(ALICE, '/mycode');
    expect(h.lastTextTo(ALICE)).toBe('Codes are no longer stored. If you lost yours, ask the organizers.');
    expect((await h.cli(['status'])).stdout).toMatch(/^Claims    1 claimed · 0 left/m);
    expect((await h.cli(['wipe', '--checksum', sum])).stdout).toBe('wiped 0 keys; the claim log is kept\n');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/cli/export-wipe.test.ts`
Expected: FAIL, 4 tests; `export` and `wipe` are not commands yet, so stderr shows the usage text.

- [ ] **Step 3: Implement**

Append to `src/store/codes.ts`:

```ts
/** Addresses of codes nobody claimed, whether or not their keys are wiped. */
export function unclaimedAddresses(db: Db, eventId: number): string[] {
  return (
    db.prepare('SELECT address FROM codes WHERE event_id = ? AND claimed_by IS NULL ORDER BY id').all(eventId) as Array<{
      address: string;
    }>
  ).map((row) => row.address);
}
```

`src/store/bulk.ts`:

```ts
// Reads every unclaimed key at once. Only src/cli may import this module; eslint.config.js enforces it,
// so the bot process contains no code path that returns more than the caller's own code.
import type { Db } from './db.js';

export function unclaimedKeys(db: Db, eventId: number): Array<{ privateKey: string; address: string }> {
  return db
    .prepare(
      `SELECT private_key AS privateKey, address FROM codes
       WHERE event_id = ? AND claimed_by IS NULL AND private_key IS NOT NULL ORDER BY id`,
    )
    .all(eventId) as Array<{ privateKey: string; address: string }>;
}

/** Deletes every key, claimed or not, and the passphrase hash. Returns how many keys were deleted. */
export function wipeKeys(db: Db, eventId: number, now: number): number {
  return db.transaction((): number => {
    const { changes } = db
      .prepare('UPDATE codes SET private_key = NULL WHERE event_id = ? AND private_key IS NOT NULL')
      .run(eventId);
    db.prepare('UPDATE events SET passphrase_hash = NULL, wiped_at = COALESCE(wiped_at, ?) WHERE id = ?').run(
      now,
      eventId,
    );
    return changes;
  })();
}

/** Rewrites the file and empties the write-ahead log. Returns false when a reader kept the log busy. */
export function compactDatabase(db: Db): boolean {
  db.exec('VACUUM');
  const [result] = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
  return result?.busy === 0;
}
```

`src/cli/commands/export-wipe.ts`:

```ts
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { eventState } from '../../core/event-state.js';
import { compactDatabase, unclaimedKeys, wipeKeys } from '../../store/bulk.js';
import { unclaimedAddresses } from '../../store/codes.js';
import { updateEvent } from '../../store/events.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError, required } from '../errors.js';
import { requireEvent } from './event.js';

/** First 16 hex characters of SHA-256 over the sorted unclaimed addresses, newline-joined. */
function checksum(addresses: readonly string[]): string {
  return createHash('sha256').update([...addresses].sort().join('\n')).digest('hex').slice(0, 16);
}

export function exportCodes(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = requireEvent(env);
  const state = eventState(event, env.deps.clock.now());
  if (state === 'wiped') throw new CliError('the keys are already wiped');
  if (state !== 'closed') throw new CliError('the event is still open; close it first with "dispenser event close"');
  const db = env.db();
  const keys = unclaimedKeys(db, event.id);
  for (const { privateKey } of keys) env.out(privateKey);
  env.err(`checksum: ${checksum(unclaimedAddresses(db, event.id))} (${keys.length} codes)`);
  updateEvent(db, event.id, { exportedAt: env.deps.clock.now() });
}

export function wipe(env: CommandEnv): void {
  const { values } = cliArgs(() =>
    parseArgs({ args: env.argv, options: { checksum: { type: 'string' } }, strict: true }),
  );
  const given = required(values.checksum, '--checksum');
  const event = requireEvent(env);
  if (event.exportedAt === null) throw new CliError('run "dispenser export" first, and keep its output');
  const db = env.db();
  if (given !== checksum(unclaimedAddresses(db, event.id))) {
    throw new CliError('the checksum does not match the last export; nothing was deleted');
  }
  const deleted = wipeKeys(db, event.id, env.deps.clock.now());
  const compacted = compactDatabase(db);
  env.out(`wiped ${deleted} keys; the claim log is kept`);
  if (!compacted) env.err('the database was busy, so it may not be fully compacted; run the same wipe again');
}
```

In `src/cli/run-cli.ts`, add the import next to the other command imports:

```ts
import { exportCodes, wipe } from './commands/export-wipe.js';
```

and add to `COMMANDS`:

```ts
  export: exportCodes,
  wipe,
```


- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/cli/export-wipe.test.ts`
Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Prove the import restriction works**

Add `import { unclaimedKeys } from '../store/bulk.js';` as the first line of `src/bot/claim-flow.ts`, then run `pnpm lint`.
Expected: lint fails, and one of its errors ends `store/bulk reads every key at once; only src/cli may import it  no-restricted-imports` (the other is the unused import).
Remove the line again, and run `git diff src/bot/claim-flow.ts` to check that it prints nothing.

- [ ] **Step 6: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  99 passed (99)`.

- [ ] **Step 7: Commit**

```bash
git add src/store/bulk.ts src/store/codes.ts src/cli/commands/export-wipe.ts src/cli/run-cli.ts src/cli/export-wipe.test.ts
git commit -s -m "feat(cli): export unclaimed keys and wipe every key" -m "- export only after close, with a checksum of the unclaimed set
- wipe only with that checksum, then vacuum and truncate the log
- keep the claim log after the wipe"
```

---

### Task 15: `dispenser stats`

**Files:**
- Create: `src/chain/blockscout.ts`, `src/chain/milestones.ts`, `src/core/checkin.ts`, `src/cli/commands/stats.ts`
- Create (tests): `src/test/blockscout-fake.ts`
- Modify: `src/store/codes.ts`, `src/store/attempts.ts`, `src/cli/run-cli.ts`
- Test: `src/cli/stats.test.ts`

**Interfaces:**
- Produces: `createBlockscout({ baseUrl, fetch, sleep }): Blockscout` with `outgoingTransactions(address, since): Promise<OutgoingTx[]>`; `BlockscoutError`.
- Produces: `milestones(txs, claimedAt): { redeemed; boughtStorage }`, `POSTAGE_STAMP`; `DAY_MS`, `KPI_WINDOW_MS`, `inKpiWindow(claimedAt, at)`.
- Produces: `claimedCodes(db, eventId): ClaimedCode[]`, `attemptTotals(db, eventId): { tried; everLockedOut }`, and the `stats` command.
- Produces (tests): `BlockscoutFake(pageSize)` with `add(...txs)`, `failNext(status)`, `requests` and `fetch`; its items carry every field the live API returned on 2026-10-20.

- [ ] **Step 1: Write the fake and the failing test**

`src/test/blockscout-fake.ts`:

```ts
export interface FakeTx {
  from: string;
  to: string | null;
  timestamp: string;
  status?: 'ok' | 'error';
  method?: string;
}

const address = (hash: string) => ({
  ens_domain_name: null, hash, implementations: [], is_contract: false, is_scam: false, is_verified: false,
  metadata: null, name: null, private_tags: [], proxy_type: null, public_tags: [], reputation: 'ok',
  watchlist_names: [],
});

/** A transaction item with every field the live Gnosis Blockscout v2 API returns (captured 2026-10-20). */
function apiTransaction(tx: FakeTx, n: number) {
  return {
    has_error_in_internal_transactions: false, block_number: 48_850_000 + n, exchange_rate: '1.0',
    transaction_types: ['contract_call'], historic_exchange_rate: null, nonce: n, timestamp: tx.timestamp,
    base_fee_per_gas: '15', token_transfers: null, fhe_operations_count: 0, decoded_input: null,
    gas_price: '140', gas_limit: '650291', fee: { type: 'actual', value: '64874320' },
    method: tx.method ?? null, authorization_list: [], to: tx.to === null ? null : address(tx.to),
    status: tx.status ?? 'ok', gas_used: '463388', from: address(tx.from), value: '0', created_contract: null,
    transaction_tag: null, max_priority_fee_per_gas: '125', position: 12, confirmations: 252,
    token_transfers_overflow: null, type: 2, transaction_burnt_fee: '6950820', confirmation_duration: [0, 5000],
    revert_reason: null, max_fee_per_gas: '140', hash: `0x${n.toString(16).padStart(64, '0')}`,
    result: tx.status === 'error' ? 'Reverted' : 'success', is_pending_update: false, raw_input: '0x',
    priority_fee: '58',
  };
}

/**
 * Serves /api/v2/addresses/:address/transactions?filter=from like the live API: the sender's
 * transactions, newest first, in pages. Refuses requests without filter=from.
 */
export class BlockscoutFake {
  readonly requests: string[] = [];
  private readonly txs: FakeTx[] = [];
  private readonly queued: number[] = [];

  constructor(private readonly pageSize = 50) {}

  add(...txs: FakeTx[]): void {
    this.txs.push(...txs);
  }

  /** The next request answers with this HTTP status instead. */
  failNext(status: number): void {
    this.queued.push(status);
  }

  readonly fetch: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    this.requests.push(url.toString());
    const status = this.queued.shift();
    if (status !== undefined) return new Response('{"message":"Too Many Requests"}', { status });
    const match = /^\/api\/v2\/addresses\/(0x[0-9a-fA-F]{40})\/transactions$/.exec(url.pathname);
    if (!match?.[1] || url.searchParams.get('filter') !== 'from') return new Response('{}', { status: 400 });
    const sender = match[1].toLowerCase();
    const mine = this.txs
      .filter((tx) => tx.from.toLowerCase() === sender)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const page = Number(url.searchParams.get('page') ?? 0);
    const items = mine.slice(page * this.pageSize, (page + 1) * this.pageSize).map((tx, i) => apiTransaction(tx, i));
    const more = (page + 1) * this.pageSize < mine.length;
    return Response.json({ items, next_page_params: more ? { page: page + 1, filter: 'from' } : null });
  };
}
```

`src/cli/stats.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { POSTAGE_STAMP } from '../chain/milestones.js';
import { BlockscoutFake } from '../test/blockscout-fake.js';
import { Harness, PASSPHRASE } from '../test/harness.js';
import { ADDRESS_1, ADDRESS_2, ADDRESS_3 } from '../test/keys.js';

const ALICE = 5001;
const BOB = 5002;
const CAROL = 5003;
const XBZZ = '0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da';
const SOMEONE = '0x000000000000000000000000000000000000dEaD';

let h: Harness;
let chain: BlockscoutFake;
beforeEach(async () => {
  h = new Harness();
  chain = new BlockscoutFake(2);
  h.fetch = chain.fetch;
  await h.openEvent();
  await h.say(ALICE, PASSPHRASE); // key(1) at 10:00:01
  await h.say(BOB, PASSPHRASE); // key(2) at 10:00:02
  await h.say(CAROL, PASSPHRASE); // key(3) at 10:00:03
  await h.ok(['event', 'close']);
});
afterEach(() => h.close());

describe('dispenser stats', () => {
  test('reports the funnel as totals, counting only sent transactions within 30 days of each claim', async () => {
    chain.add(
      // Alice approves xBZZ, buys a postage batch, then sends something else: three outgoing, two pages.
      { from: ADDRESS_1, to: XBZZ, timestamp: '2026-11-15T09:00:00.000000Z', method: 'approve' },
      { from: ADDRESS_1, to: POSTAGE_STAMP, timestamp: '2026-11-15T09:00:05.000000Z', method: 'createBatch' },
      { from: ADDRESS_1, to: SOMEONE, timestamp: '2026-11-20T09:00:00.000000Z' },
      // Bob's createBatch reverted, then he moved funds out: redeemed, but bought no storage.
      { from: ADDRESS_2, to: POSTAGE_STAMP, timestamp: '2026-11-16T09:00:00.000000Z', status: 'error' },
      { from: ADDRESS_2, to: SOMEONE, timestamp: '2026-11-16T09:10:00.000000Z' },
      // Carol: one transaction before her claim, one after day 30. Neither counts.
      { from: ADDRESS_3, to: POSTAGE_STAMP, timestamp: '2026-11-14T09:00:00.000000Z' },
      { from: ADDRESS_3, to: POSTAGE_STAMP, timestamp: '2026-12-14T10:00:04.000000Z' },
      // Someone funding Alice: incoming, never returned for filter=from.
      { from: SOMEONE, to: ADDRESS_1, timestamp: '2026-11-15T08:00:00.000000Z' },
    );
    h.clock.set('2026-11-21T12:00:00Z');
    const result = await h.cli(['stats']);
    expect(result.stdout).toBe(
      [
        `${'Swarm booth'.padEnd(46)}window: 30 days (in progress, final on 2026-12-14)`,
        '─'.repeat(70),
        'Bot       tried passphrase 3 · claimed 3 · locked out 0',
        'Chain     redeemed 2 (67%) · bought storage 1 (33%)',
        'Check-in  sent 0 · unreachable 0 · failed 0 · answered 0',
        '          uploaded 0 · not yet 0 · stuck 0 (installing 0 · key 0 · uploading 0 · other 0)',
        '',
      ].join('\n'),
    );
    for (const secretish of [ADDRESS_1, ADDRESS_2, ADDRESS_3, String(ALICE)]) expect(result.stdout).not.toContain(secretish);
    expect(chain.requests.every((r) => r.includes('filter=from'))).toBe(true);
  });

  test('says final once 30 days have passed since the last claim', async () => {
    h.clock.set('2026-12-14T10:00:03Z');
    expect((await h.cli(['stats'])).stdout).toMatch(/window: 30 days \(final\)$/m);
  });

  test('waits and retries when rate limited', async () => {
    chain.add({ from: ADDRESS_1, to: POSTAGE_STAMP, timestamp: '2026-11-15T09:00:00.000000Z' });
    chain.failNext(429);
    expect((await h.cli(['stats'])).stdout).toMatch(/^Chain     redeemed 1 \(33%\) · bought storage 1 \(33%\)$/m);
    expect(h.sleeps).toContain(2000);
  });

  test('fails with a clear error when Blockscout is down, naming no address', async () => {
    chain.failNext(503);
    const result = await h.cli(['stats']);
    expect(result.stderr).toBe('error: Blockscout answered 503; try again later\n');
  });

  test('counts every account that tried, and every lockout even after unlock', async () => {
    h.close();
    h = new Harness();
    h.fetch = new BlockscoutFake().fetch;
    await h.openEvent();
    for (let i = 0; i < 5; i += 1) await h.say(4242, `guess ${i}`);
    await h.ok(['unlock', '4242']);
    await h.say(ALICE, PASSPHRASE);
    expect((await h.cli(['stats'])).stdout).toMatch(/^Bot       tried passphrase 2 · claimed 1 · locked out 1$/m);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/cli/stats.test.ts`
Expected: FAIL with `Error: Cannot find module '../chain/milestones.js'`.

- [ ] **Step 3: Write the chain client and the milestones**

`src/core/checkin.ts` (Task 16 adds the check-in message):

```ts
export const DAY_MS = 24 * 60 * 60 * 1000;
export const KPI_WINDOW_MS = 30 * DAY_MS;

/** True when `at` is after the claim and no later than 30 days after it. */
export function inKpiWindow(claimedAt: number, at: number): boolean {
  return at > claimedAt && at <= claimedAt + KPI_WINDOW_MS;
}
```

`src/chain/blockscout.ts`:

```ts
export interface OutgoingTx {
  to: string | null;
  timestamp: number;
  ok: boolean;
}

export interface Blockscout {
  /** Transactions sent from `address`, newest first, back to at least `since`. */
  outgoingTransactions(address: string, since: number): Promise<OutgoingTx[]>;
}

export interface BlockscoutOptions {
  baseUrl: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export class BlockscoutError extends Error {
  override name = 'BlockscoutError';
}

interface ApiTransaction {
  timestamp: string;
  status: string | null;
  from: { hash: string };
  to: { hash: string } | null;
}

interface ApiPage {
  items: ApiTransaction[];
  next_page_params: Record<string, string | number> | null;
}

/** Waits between requests to stay under Blockscout's rate limit. */
const REQUEST_GAP_MS = 250;
const MAX_RETRIES = 5;
const MAX_PAGES = 20;

export function createBlockscout(options: BlockscoutOptions): Blockscout {
  let requests = 0;

  async function getPage(url: URL): Promise<ApiPage> {
    for (let attempt = 0; ; attempt += 1) {
      if (requests > 0) await options.sleep(REQUEST_GAP_MS);
      requests += 1;
      const response = await options.fetch(url, { headers: { accept: 'application/json' } });
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await options.sleep(retryDelay(response));
        continue;
      }
      if (!response.ok) throw new BlockscoutError(`Blockscout answered ${response.status}`);
      return (await response.json()) as ApiPage;
    }
  }

  return {
    async outgoingTransactions(address, since) {
      const found: OutgoingTx[] = [];
      let params: Record<string, string | number> | null = {};
      for (let page = 0; params !== null && page < MAX_PAGES; page += 1) {
        const url = new URL(`/api/v2/addresses/${address}/transactions`, options.baseUrl);
        for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
        url.searchParams.set('filter', 'from');
        const body = await getPage(url);
        for (const tx of body.items) {
          if (tx.from.hash.toLowerCase() !== address.toLowerCase()) continue;
          found.push({ to: tx.to?.hash ?? null, timestamp: Date.parse(tx.timestamp), ok: tx.status === 'ok' });
        }
        const oldest = body.items.at(-1);
        params = oldest !== undefined && Date.parse(oldest.timestamp) > since ? body.next_page_params : null;
      }
      return found;
    },
  };
}

function retryDelay(response: Response): number {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  return Number.isFinite(reset) && reset > 0 && reset <= 60_000 ? reset : 2_000;
}
```

`src/chain/milestones.ts`:

```ts
import { inKpiWindow } from '../core/checkin.js';
import type { OutgoingTx } from './blockscout.js';

/** Swarm's PostageStamp contract on Gnosis Chain ("PostageStamp v2.1"). */
export const POSTAGE_STAMP = '0x45a1502382541Cd610CC9068e88727426b696293';

export interface Milestones {
  redeemed: boolean;
  boughtStorage: boolean;
}

/** Counts only transactions sent after the claim and within 30 days of it. */
export function milestones(txs: readonly OutgoingTx[], claimedAt: number): Milestones {
  const inWindow = txs.filter((tx) => inKpiWindow(claimedAt, tx.timestamp));
  return {
    redeemed: inWindow.length > 0,
    boughtStorage: inWindow.some((tx) => tx.ok && tx.to?.toLowerCase() === POSTAGE_STAMP.toLowerCase()),
  };
}
```

- [ ] **Step 4: Write the command**

Append to `src/store/codes.ts`:

```ts
export function claimedCodes(db: Db, eventId: number): ClaimedCode[] {
  return db
    .prepare(`${CLAIMED} WHERE event_id = ? AND claimed_by IS NOT NULL ORDER BY claimed_at, id`)
    .all(eventId) as ClaimedCode[];
}
```

Append to `src/store/attempts.ts`:

```ts
/** Accounts that sent at least one passphrase (attempts only records failures, so claimants are added). */
export function attemptTotals(db: Db, eventId: number): { tried: number; everLockedOut: number } {
  const tried = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT telegram_user_id FROM attempts WHERE event_id = @eventId
         UNION
         SELECT claimed_by FROM codes WHERE event_id = @eventId AND claimed_by IS NOT NULL)`,
    )
    .get({ eventId }) as { n: number };
  const locked = db
    .prepare('SELECT COUNT(*) AS n FROM attempts WHERE event_id = ? AND locked_at IS NOT NULL')
    .get(eventId) as { n: number };
  return { tried: tried.n, everLockedOut: locked.n };
}
```

`src/cli/commands/stats.ts`:

```ts
import { parseArgs } from 'node:util';
import { BlockscoutError, createBlockscout } from '../../chain/blockscout.js';
import { milestones } from '../../chain/milestones.js';
import { KPI_WINDOW_MS } from '../../core/checkin.js';
import { attemptTotals } from '../../store/attempts.js';
import { claimedCodes, type CheckinAnswer } from '../../store/codes.js';
import { formatDate } from '../../time.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError } from '../errors.js';
import { requireEvent } from './event.js';

const percent = (part: number, whole: number): string => `${whole === 0 ? 0 : Math.round((100 * part) / whole)}%`;

export async function stats(env: CommandEnv): Promise<void> {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = requireEvent(env);
  const db = env.db();
  const claims = claimedCodes(db, event.id);
  const { tried, everLockedOut } = attemptTotals(db, event.id);

  const chain = createBlockscout({ baseUrl: env.deps.blockscoutUrl, fetch: env.deps.fetch, sleep: env.deps.sleep });
  let redeemed = 0;
  let boughtStorage = 0;
  for (const claim of claims) {
    let txs;
    try {
      txs = await chain.outgoingTransactions(claim.address, claim.claimedAt);
    } catch (err) {
      if (err instanceof BlockscoutError) throw new CliError(`${err.message}; try again later`);
      throw err;
    }
    const result = milestones(txs, claim.claimedAt);
    if (result.redeemed) redeemed += 1;
    if (result.boughtStorage) boughtStorage += 1;
  }

  const count = (answer: CheckinAnswer) => claims.filter((c) => c.checkinAnswer === answer).length;
  const sent = claims.filter((c) => c.checkinStatus !== null).length;
  const unreachable = claims.filter((c) => c.checkinStatus === 'unreachable').length;
  const failed = claims.filter((c) => c.checkinStatus === 'failed').length;
  const answered = claims.filter((c) => c.checkinAnswer !== null).length;
  const stuck = count('stuck_install') + count('stuck_import') + count('stuck_upload') + count('stuck_other');

  const lastClaimAt = claims.at(-1)?.claimedAt;
  const finalAt = lastClaimAt === undefined ? undefined : lastClaimAt + KPI_WINDOW_MS;
  const window =
    finalAt === undefined || env.deps.clock.now() >= finalAt
      ? 'window: 30 days (final)'
      : `window: 30 days (in progress, final on ${formatDate(finalAt, event.tz)})`;
  const n = claims.length;

  env.out(`${event.title.padEnd(46)}${window}`);
  env.out('─'.repeat(70));
  env.out(`Bot       tried passphrase ${tried} · claimed ${n} · locked out ${everLockedOut}`);
  env.out(`Chain     redeemed ${redeemed} (${percent(redeemed, n)}) · bought storage ${boughtStorage} (${percent(boughtStorage, n)})`);
  env.out(`Check-in  sent ${sent} · unreachable ${unreachable} · failed ${failed} · answered ${answered}`);
  env.out(
    `          uploaded ${count('uploaded')} · not yet ${count('not_yet')} · stuck ${stuck} ` +
      `(installing ${count('stuck_install')} · key ${count('stuck_import')} · uploading ${count('stuck_upload')} · other ${count('stuck_other')})`,
  );
}
```

In `src/cli/run-cli.ts`, add the import next to the other command imports:

```ts
import { stats } from './commands/stats.js';
```

and add to `COMMANDS`:

```ts
  stats,
```


- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/cli/stats.test.ts`
Expected: `Tests  5 passed (5)`.

- [ ] **Step 6: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  104 passed (104)`.

- [ ] **Step 7: Commit**

```bash
git add src/chain/blockscout.ts src/chain/milestones.ts src/core/checkin.ts src/cli/commands/stats.ts src/store/codes.ts src/store/attempts.ts src/cli/run-cli.ts src/test/blockscout-fake.ts src/cli/stats.test.ts
git commit -s -m "feat(cli): report the kpi funnel with dispenser stats" -m "- count redeemed and bought-storage addresses from blockscout, within 30 days of each claim
- page through results and wait out rate limits
- print totals only, never an address or an account"
```

---

### Task 16: The check-in

**Files:**
- Create: `src/bot/checkin-taps.ts`, `src/cli/commands/checkin.ts`
- Modify: `src/core/checkin.ts`, `src/store/codes.ts`, `src/bot/create-bot.ts`, `src/cli/run-cli.ts`
- Test: `src/cli/checkin.test.ts`, `src/bot/checkin.test.ts`

**Interfaces:**
- Produces: `parseCheckinData(data): CheckinAnswer | null`, `checkinText(title, claimedAt, now)`, `CHECKIN_KEYBOARD`; `markCheckinSent`, `setCheckinStatus`, `recordCheckinAnswer`; `checkinTap(flow, userId, data): string | null`; the `checkin send` command.

- [ ] **Step 1: Write the failing tests**

`src/cli/checkin.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CHECKIN_KEYBOARD } from '../core/checkin.js';
import { Harness, PASSPHRASE } from '../test/harness.js';

const ALICE = 5001;
const BOB = 5002;
const CAROL = 5003;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
  await h.say(ALICE, PASSPHRASE); // 2026-11-14 10:00:01
  await h.say(BOB, PASSPHRASE);
  await h.say(CAROL, PASSPHRASE);
  await h.ok(['event', 'close']);
});
afterEach(() => h.close());

describe('dispenser checkin send', () => {
  test('refuses while the event is open', async () => {
    h.close();
    h = new Harness();
    await h.openEvent();
    expect((await h.cli(['checkin', 'send'])).stderr).toBe('error: send the check-in after the event has closed\n');
  });

  test('sends each claimant one message with the six answers, once', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    expect((await h.cli(['checkin', 'send'])).stdout).toBe('sent 3 · unreachable 0 · failed 0\n');
    const message = h.telegram.sent.find((s) => s.chatId === ALICE && s.text.startsWith('Hi!'));
    expect(message?.text).toBe('Hi! 7 days ago you got a Swarm gift code at Swarm booth.\nDid you upload your first file?');
    expect(message?.replyMarkup).toEqual(CHECKIN_KEYBOARD);
    expect((await h.cli(['checkin', 'send'])).stdout).toBe('sent 0 · unreachable 0 · failed 0\n');
    expect(h.telegram.sent.filter((s) => s.text.startsWith('Hi!'))).toHaveLength(3);
  });

  test('says "1 day ago" the day after', async () => {
    h.clock.set('2026-11-15T11:00:00Z');
    await h.ok(['checkin', 'send']);
    expect(h.lastTextTo(ALICE)).toMatch(/^Hi! 1 day ago /);
  });

  test('counts a blocked account as unreachable and another error as failed, and never retries them', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    h.telegram.failNext('sendMessage', { error_code: 403, description: 'Forbidden: bot was blocked by the user' });
    h.telegram.failNext('sendMessage', new Error('network down'));
    expect((await h.cli(['checkin', 'send'])).stdout).toBe('sent 1 · unreachable 1 · failed 1\n');
    expect((await h.cli(['checkin', 'send'])).stdout).toBe('sent 0 · unreachable 0 · failed 0\n');
  });
});
```

`src/bot/checkin.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE } from '../test/harness.js';

const ALICE = 5001;
const STRANGER = 6666;

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
  await h.say(ALICE, PASSPHRASE); // claimed at 2026-11-14 10:00:01 UTC
  await h.ok(['event', 'close']);
});
afterEach(() => h.close());

const lastAnswer = () => h.telegram.callbackAnswers.at(-1)?.text;
const statsLine = async () => (await h.cli(['stats'])).stdout.split('\n').find((l) => l.trimStart().startsWith('uploaded'));

describe('check-in taps', () => {
  beforeEach(() => {
    h.fetch = async () => Response.json({ items: [], next_page_params: null });
  });

  test('a tap before the check-in was sent gets an empty answer', async () => {
    await h.tap(ALICE, 'ci:uploaded');
    expect(lastAnswer()).toBeUndefined();
  });

  test("stores the claimant's answer, and a later tap replaces it", async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    await h.ok(['checkin', 'send']);
    await h.tap(ALICE, 'ci:not_yet');
    expect(lastAnswer()).toBe('Thanks! You can tap again to change your answer.');
    await h.tap(ALICE, 'ci:uploaded');
    expect(await statsLine()).toBe('          uploaded 1 · not yet 0 · stuck 0 (installing 0 · key 0 · uploading 0 · other 0)');
  });

  test('a tap from an account without a code is not stored', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    await h.ok(['checkin', 'send']);
    await h.tap(STRANGER, 'ci:uploaded');
    expect(lastAnswer()).toBeUndefined();
    expect(await statsLine()).toMatch(/uploaded 0 /);
  });

  test('closes 30 days after the claim', async () => {
    h.clock.set('2026-11-21T12:00:00Z');
    await h.ok(['checkin', 'send']);
    h.clock.set('2026-12-14T10:00:00Z'); // tap() adds 1 s: this tap lands exactly at the end of day 30
    await h.tap(ALICE, 'ci:stuck_install');
    expect(lastAnswer()).toBe('Thanks! You can tap again to change your answer.');
    h.clock.set('2026-12-14T10:00:01Z');
    await h.tap(ALICE, 'ci:uploaded');
    expect(lastAnswer()).toBe('This check-in has closed.');
    expect(await statsLine()).toMatch(/stuck 1 \(installing 1 /);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/cli/checkin.test.ts src/bot/checkin.test.ts`
Expected: FAIL, 7 tests, for example `expected '' to be 'sent 3 · unreachable 0 · failed 0\n'`.
"a tap before the check-in was sent gets an empty answer" already passes, because every tap gets an empty answer so far.

- [ ] **Step 3: Write the message and the store**

Replace `src/core/checkin.ts` with:

```ts
import type { InlineKeyboardMarkup } from 'grammy/types';
import { CHECKIN_ANSWERS, type CheckinAnswer } from '../store/codes.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const KPI_WINDOW_MS = 30 * DAY_MS;

/** True when `at` is after the claim and no later than 30 days after it. */
export function inKpiWindow(claimedAt: number, at: number): boolean {
  return at > claimedAt && at <= claimedAt + KPI_WINDOW_MS;
}

/** Accepts exactly `ci:<answer>`; anything else is null. */
export function parseCheckinData(data: string): CheckinAnswer | null {
  const answer = /^ci:([a-z_]+)$/.exec(data)?.[1];
  return CHECKIN_ANSWERS.find((a) => a === answer) ?? null;
}

export function checkinText(title: string, claimedAt: number, now: number): string {
  const days = Math.max(1, Math.floor((now - claimedAt) / DAY_MS));
  return `Hi! ${days} ${days === 1 ? 'day' : 'days'} ago you got a Swarm gift code at ${title}.\nDid you upload your first file?`;
}

export const CHECKIN_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: 'Yes', callback_data: 'ci:uploaded' },
      { text: 'Not yet', callback_data: 'ci:not_yet' },
    ],
    [
      { text: 'Stuck installing Bee', callback_data: 'ci:stuck_install' },
      { text: 'Stuck importing the key', callback_data: 'ci:stuck_import' },
    ],
    [
      { text: 'Stuck uploading', callback_data: 'ci:stuck_upload' },
      { text: 'Stuck on something else', callback_data: 'ci:stuck_other' },
    ],
  ],
};
```

Append to `src/store/codes.ts`:

```ts
export function markCheckinSent(db: Db, codeId: number, now: number): void {
  db.prepare("UPDATE codes SET checkin_status = 'sent', checkin_sent_at = ? WHERE id = ?").run(now, codeId);
}

export function setCheckinStatus(db: Db, codeId: number, status: CheckinStatus): void {
  db.prepare('UPDATE codes SET checkin_status = ? WHERE id = ?').run(status, codeId);
}

export function recordCheckinAnswer(db: Db, codeId: number, answer: CheckinAnswer, now: number): void {
  db.prepare('UPDATE codes SET checkin_answer = ?, checkin_answered_at = ? WHERE id = ?').run(answer, now, codeId);
}
```

- [ ] **Step 4: Send it and record the taps**

`src/cli/commands/checkin.ts`:

```ts
import { GrammyError } from 'grammy';
import { parseArgs } from 'node:util';
import { CHECKIN_KEYBOARD, checkinText } from '../../core/checkin.js';
import { eventState } from '../../core/event-state.js';
import { claimedCodes, markCheckinSent, setCheckinStatus } from '../../store/codes.js';
import type { CommandEnv } from '../env.js';
import { cliArgs, CliError } from '../errors.js';
import { requireEvent } from './event.js';

/** Telegram allows about 30 messages per second; stay well under it. */
const SEND_GAP_MS = 50;

export async function checkinSend(env: CommandEnv): Promise<void> {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const event = requireEvent(env);
  const state = eventState(event, env.deps.clock.now());
  if (state !== 'closed' && state !== 'wiped') throw new CliError('send the check-in after the event has closed');

  const db = env.db();
  const counts = { sent: 0, unreachable: 0, failed: 0 };
  const pending = claimedCodes(db, event.id).filter((code) => code.checkinStatus === null);
  for (const code of pending) {
    const now = env.deps.clock.now();
    markCheckinSent(db, code.id, now);
    try {
      await env.api().sendMessage(code.claimedBy, checkinText(event.title, code.claimedAt, now), {
        reply_markup: CHECKIN_KEYBOARD,
      });
      counts.sent += 1;
    } catch (err) {
      const blocked = err instanceof GrammyError && err.error_code === 403;
      setCheckinStatus(db, code.id, blocked ? 'unreachable' : 'failed');
      counts[blocked ? 'unreachable' : 'failed'] += 1;
    }
    await env.deps.sleep(SEND_GAP_MS);
  }
  env.out(`sent ${counts.sent} · unreachable ${counts.unreachable} · failed ${counts.failed}`);
}
```

In `src/cli/run-cli.ts`, add the import next to the other command imports:

```ts
import { checkinSend } from './commands/checkin.js';
```

and add to `COMMANDS`:

```ts
  'checkin send': checkinSend,
```


`src/bot/checkin-taps.ts`:

```ts
import { inKpiWindow, parseCheckinData } from '../core/checkin.js';
import { findCodeByClaimer, recordCheckinAnswer } from '../store/codes.js';
import { getEvent } from '../store/events.js';
import type { Flow } from './flow.js';

/** Returns the pop-up text for a valid tap, or null to answer with nothing. */
export function checkinTap(flow: Flow, userId: number, data: string): string | null {
  const answer = parseCheckinData(data);
  if (answer === null) return null;
  const event = getEvent(flow.db);
  const code = event ? findCodeByClaimer(flow.db, event.id, userId) : undefined;
  if (!code || code.checkinStatus === null) return null;
  const now = flow.clock.now();
  if (!inKpiWindow(code.claimedAt, now)) return 'This check-in has closed.';
  recordCheckinAnswer(flow.db, code.id, answer, now);
  return 'Thanks! You can tap again to change your answer.';
}
```

Replace `src/bot/create-bot.ts` with:

```ts
import { Bot, BotError, type Context, type Middleware, type Transformer } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { Clock } from '../clock.js';
import { errorFields, type Logger } from '../log.js';
import { openDatabase } from '../store/db.js';
import { checkinTap } from './checkin-taps.js';
import { myCodeReply, notifyAdmin, startReply, textReply } from './claim-flow.js';
import type { Flow, Reply } from './flow.js';
import { handleGroupStatus } from './group-status.js';
import { msg, tripMessage } from './messages.js';
import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimit } from './rate-limit.js';

export interface BotDeps {
  token: string;
  botInfo: UserFromGetMe;
  dataDir: string;
  adminUserId: number;
  clock: Clock;
  log: Logger;
  /** Installed on the API client, e.g. auto-retry in production or the Telegram fake in tests. */
  transformers?: Transformer[];
  /** Installed ahead of every handler, e.g. the runner's sequentialize in production. */
  before?: Middleware<Context>[];
  rateLimit?: RateLimit;
}

export interface DispenserBot {
  bot: Bot;
  /** Handles one update the way the runner does: errors go to the bot's error handler. */
  handleUpdate(update: Update): Promise<void>;
  close(): void;
}

function updateType(update: Update): string {
  return Object.keys(update).find((key) => key !== 'update_id') ?? 'unknown';
}

export function createBot(deps: BotDeps): DispenserBot {
  const db = openDatabase(deps.dataDir);
  const bot = new Bot(deps.token, { botInfo: deps.botInfo });
  for (const transformer of deps.transformers ?? []) bot.api.config.use(transformer);
  for (const middleware of deps.before ?? []) bot.use(middleware);

  const flow: Flow = { db, clock: deps.clock, log: deps.log, adminUserId: deps.adminUserId, botId: deps.botInfo.id };
  const allow = createRateLimiter(deps.clock, deps.rateLimit ?? DEFAULT_RATE_LIMIT);
  const options = (reply: Reply) => (reply.html ? { parse_mode: 'HTML' as const } : {});

  bot.on('my_chat_member', (ctx) => handleGroupStatus(ctx.api, flow, ctx.myChatMember));

  const priv = bot.chatType('private');
  priv.use(async (ctx, next) => {
    if (allow(ctx.from.id)) await next();
  });
  priv.command('start', (ctx) => ctx.reply(startReply(flow, ctx.from.id)));
  priv.command('mycode', async (ctx) => {
    const reply = myCodeReply(flow, ctx.from.id);
    await ctx.reply(reply.text, options(reply));
  });
  priv.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply(startReply(flow, ctx.from.id));
      return;
    }
    let outcome;
    try {
      outcome = await textReply(ctx.api, flow, ctx.from.id, ctx.message.text);
    } catch (err) {
      flow.log.error('claim flow failed', { user: ctx.from.id, ...errorFields(err) });
      await ctx.reply(msg.somethingWrong);
      return;
    }
    try {
      await ctx.reply(outcome.reply.text, options(outcome.reply));
    } finally {
      if (outcome.trippedEvent) await notifyAdmin(ctx.api, flow, tripMessage(outcome.trippedEvent));
    }
  });
  priv.on('callback_query:data', async (ctx) => {
    const text = checkinTap(flow, ctx.from.id, ctx.callbackQuery.data);
    await ctx.answerCallbackQuery(text === null ? undefined : { text });
  });
  priv.on('message', (ctx) => ctx.reply(startReply(flow, ctx.from.id)));
  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery());

  bot.catch((err) => {
    deps.log.error('update failed', {
      updateId: err.ctx.update.update_id,
      updateType: updateType(err.ctx.update),
      ...errorFields(err.error),
    });
  });

  return {
    bot,
    async handleUpdate(update) {
      try {
        await bot.handleUpdate(update);
      } catch (err) {
        if (!(err instanceof BotError)) throw err;
        await bot.errorHandler(err);
      }
    },
    close: () => db.close(),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/cli/checkin.test.ts src/bot/checkin.test.ts`
Expected: `Tests  8 passed (8)`.

- [ ] **Step 6: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  112 passed (112)`.

- [ ] **Step 7: Commit**

```bash
git add src/core/checkin.ts src/store/codes.ts src/cli/commands/checkin.ts src/cli/run-cli.ts src/bot/checkin-taps.ts src/bot/create-bot.ts src/cli/checkin.test.ts src/bot/checkin.test.ts
git commit -s -m "feat: send the check-in and record one-tap answers" -m "- send each claimant one check-in after close, marking it sent first
- count blocked accounts as unreachable and other errors as failed
- store a claimant's tap until day 30; a later tap replaces it"
```

---

### Task 17: No secrets in logs

**Files:**
- Test: `src/bot/logs.test.ts`

This test guards rules every earlier task followed, so it passes on its first run.
Step 3 proves that it can fail.

- [ ] **Step 1: Write the test**

`src/bot/logs.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Harness, PASSPHRASE, TOKEN } from '../test/harness.js';
import { key } from '../test/keys.js';

let h: Harness;
beforeEach(async () => {
  h = new Harness();
  await h.openEvent();
});
afterEach(() => h.close());

describe('logs', () => {
  test('carry no key, passphrase, token or message text, on success and error paths', async () => {
    const leakyError = () => new Error(`request to https://api.telegram.org/bot${TOKEN}/x failed`);
    await h.say(5001, PASSPHRASE);
    for (let i = 0; i < 5; i += 1) await h.say(5002, `my secret guess ${i}`);
    h.telegram.failNext('getChatMember', leakyError());
    await h.say(5003, PASSPHRASE);
    h.telegram.failNext('sendMessage', leakyError());
    await h.say(5004, PASSPHRASE);
    h.telegram.failNext('getMe', leakyError());
    await h.cli(['status']);
    await h.ok(['event', 'close']);
    await h.ok(['export']);

    const all = h.logs.join('\n');
    expect(h.logs.map((line) => JSON.parse(line).msg)).toEqual(
      expect.arrayContaining(['claimed', 'wrong passphrase', 'membership lookup failed', 'update failed']),
    );
    for (const n of [1, 2, 3]) expect(all).not.toContain(key(n).slice(2));
    expect(all.toLowerCase()).not.toContain(PASSPHRASE.toLowerCase());
    expect(all).not.toContain('my secret guess');
    expect(all).not.toContain(TOKEN);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run src/bot/logs.test.ts`
Expected: `Tests  1 passed (1)`.

- [ ] **Step 3: Prove it can fail**

In `src/bot/claim-flow.ts`, inside `textReply`, add this line right after `const { db, clock, log } = flow;`:

```ts
  log.info('debug', { text });
```

Run: `pnpm vitest run src/bot/logs.test.ts`
Expected: FAIL, with `expected '…' not to contain 'orbit maple lantern'`.
Remove the line again, and run `git diff src/bot/claim-flow.ts` to check that it prints nothing.

- [ ] **Step 4: Run all checks**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  113 passed (113)`.

- [ ] **Step 5: Commit**

```bash
git add src/bot/logs.test.ts
git commit -s -m "test(bot): guard that logs carry no secrets" -m "- run success and error paths and check every log line for keys, passphrases, the token and message text"
```

---

### Task 18: Entry points, image and deployment

**Files:**
- Create: `src/config.ts`, `src/cli/terminal.ts`, `src/main.ts`
- Create: `Dockerfile`, `.dockerignore`, `deploy/compose.yaml`, `deploy/dispenser`
- Create: `README.md`, `docs/dry-run.md`

**Interfaces:**
- Consumes: `createBot` (Task 5 onward), `runCli` (Task 2 onward), `createLogger`, `systemClock` (Task 2).
- Produces: `loadConfig(env): Config`; `node dist/main.js bot` and `node dist/main.js dispenser <command>`.

The entry points are wiring around the seams, so they have no tests of their own.
Steps 4 to 6 check them by running them.

- [ ] **Step 1: Write the entry points**

`src/config.ts`:

```ts
import { isTimeZone } from './time.js';

export interface Config {
  token: string;
  adminUserId: number;
  tz: string;
  dataDir: string;
  blockscoutUrl: string;
}

/** Reads bot.env. Throws a message naming the variable that is wrong, never its value. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const token = env.BOT_TOKEN ?? '';
  if (!/^\d+:[\w-]{20,}$/.test(token)) throw new Error('BOT_TOKEN is missing or malformed');
  const adminUserId = Number(env.ADMIN_USER_ID);
  if (!Number.isSafeInteger(adminUserId) || adminUserId <= 0) {
    throw new Error('ADMIN_USER_ID must be your numeric Telegram user ID');
  }
  const tz = env.TZ ?? 'UTC';
  if (!isTimeZone(tz)) throw new Error(`TZ "${tz}" is not a known time zone`);
  return {
    token,
    adminUserId,
    tz,
    dataDir: env.DATA_DIR ?? '/data',
    blockscoutUrl: env.BLOCKSCOUT_URL ?? 'https://gnosisscan.io',
  };
}
```

`src/cli/terminal.ts`:

```ts
import { createInterface } from 'node:readline';
import type { Terminal } from './env.js';

/** The real terminal: prompts on stderr, so stdout carries only command output. */
export function processTerminal(): Terminal {
  return {
    isTTY: process.stdin.isTTY === true,
    ask: (question, { hidden }) =>
      new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
        rl.question(question, (answer) => {
          rl.close();
          if (hidden) process.stderr.write('\n');
          resolve(answer);
        });
        if (hidden) {
          // Stop echoing what is typed; the prompt itself was already written.
          (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => {};
        }
      }),
  };
}

export async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}
```

`src/main.ts`:

```ts
import { autoRetry } from '@grammyjs/auto-retry';
import { run, sequentialize } from '@grammyjs/runner';
import { Api, type Transformer } from 'grammy';
import { randomInt } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createBot } from './bot/create-bot.js';
import { runCli } from './cli/run-cli.js';
import { processTerminal, readAllStdin } from './cli/terminal.js';
import { systemClock } from './clock.js';
import { loadConfig, type Config } from './config.js';
import { createLogger, errorFields } from './log.js';

const POLL_TIMEOUT_MS = 3 * 60 * 1000;

async function runBot(config: Config): Promise<void> {
  const log = createLogger((line) => process.stdout.write(`${line}\n`), [config.token], systemClock);
  process.on('unhandledRejection', (err) => {
    log.error('unhandled rejection', errorFields(err));
    process.exit(1);
  });

  let lastPollOk = Date.now();
  const watchPolling: Transformer = async (prev, method, payload, signal) => {
    const response = await prev(method, payload, signal);
    if (method === 'getUpdates' && response.ok) lastPollOk = Date.now();
    return response;
  };

  const botInfo = await new Api(config.token).getMe();
  const app = createBot({
    token: config.token,
    botInfo,
    dataDir: config.dataDir,
    adminUserId: config.adminUserId,
    clock: systemClock,
    log,
    transformers: [autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }), watchPolling],
    before: [sequentialize((ctx) => ctx.from?.id.toString())],
  });
  const runner = run(app.bot, {
    runner: { fetch: { allowed_updates: ['message', 'callback_query', 'my_chat_member'] } },
  });
  log.info('bot started', { username: botInfo.username });

  const watchdog = setInterval(() => {
    if (Date.now() - lastPollOk > POLL_TIMEOUT_MS) {
      log.error('polling has failed for 3 minutes; exiting so Docker restarts the bot');
      process.exit(1);
    }
  }, 30_000);

  const shutdown = async () => {
    clearInterval(watchdog);
    await Promise.race([runner.stop(), sleep(10_000)]);
    app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  await runner.task();
}

async function runDispenser(argv: string[], config: Config): Promise<number> {
  const result = await runCli(argv, readAllStdin, {
    dataDir: config.dataDir,
    token: config.token,
    defaultTz: config.tz,
    clock: systemClock,
    log: createLogger((line) => process.stderr.write(`${line}\n`), [config.token], systemClock),
    terminal: processTerminal(),
    randomInt: (max) => randomInt(max),
    transformers: [autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 })],
    fetch,
    blockscoutUrl: config.blockscoutUrl,
    sleep: (ms) => sleep(ms),
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.code;
}

const [mode, ...rest] = process.argv.slice(2);
try {
  const config = loadConfig(process.env);
  if (mode === 'bot') await runBot(config);
  else if (mode === 'dispenser') process.exitCode = await runDispenser(rest, config);
  else {
    process.stderr.write('usage: main.js bot | main.js dispenser <command>\n');
    process.exitCode = 2;
  }
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
```

- [ ] **Step 2: Write the image and the deployment files**

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
RUN npm install --global pnpm@11.24.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER 10001:10001
ENTRYPOINT ["node", "/app/dist/main.js"]
CMD ["bot"]
```

`.dockerignore`:

```text
node_modules
dist
coverage
.git
docs
deploy
*.db*
```

`deploy/compose.yaml`:

```yaml
# Installed at /opt/gift-dispenser/compose.yaml (spec §6.2).
services:
  bot:
    image: gift-dispenser:0.1.0
    restart: unless-stopped
    user: "10001:10001"
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    mem_limit: 256m
    env_file: /etc/gift-dispenser/bot.env
    volumes:
      - /var/lib/gift-dispenser:/data
    logging:
      options: { max-size: "10m", max-file: "3" }
```

`deploy/dispenser`, made executable with `chmod 0755 deploy/dispenser`:

```sh
#!/bin/sh
# Runs one dispenser command in a throwaway container beside the bot (spec §6.2).
# The current directory is mounted read-only at /work, so `--instructions instructions.txt` works.
# A terminal is attached only when stdin is one: prompts work over `ssh -t`, piping works over `ssh`.
set -eu
tty=-T
if [ -t 0 ]; then tty=; fi
exec docker compose -f /opt/gift-dispenser/compose.yaml run --rm --no-deps $tty \
  -v "$(pwd):/work:ro" -w /work bot dispenser "$@"
```

- [ ] **Step 3: Write the operator docs**

`README.md`:

~~~~markdown
# Telegram gift code dispenser

A Telegram bot that hands out one Swarm gift code per Telegram account at an in-person event.
To claim, a person must be a member of the event's Telegram group and send the passphrase that staff told them.
The design is in `docs/superpowers/specs/2026-10-19-telegram-gift-code-dispenser-design.md`.

## Development

Requires Node.js 22.12 or later and pnpm 11.24.0.

```sh
pnpm install
pnpm check    # typecheck, lint, tests
```

## Install on the Pi

Run these once from a checkout of this repository, as a user in the `docker` group.

```sh
docker build -t gift-dispenser:0.1.0 .
sudo mkdir -p /opt/gift-dispenser /etc/gift-dispenser /var/lib/gift-dispenser
sudo install -m 0644 deploy/compose.yaml /opt/gift-dispenser/compose.yaml
sudo install -m 0755 deploy/dispenser /usr/local/bin/dispenser
sudo chown 10001:10001 /var/lib/gift-dispenser
sudo chmod 0700 /var/lib/gift-dispenser
```

Create `/etc/gift-dispenser/bot.env`, owned by you and readable only by you:

```sh
sudo install -m 0600 -o "$USER" /dev/null /etc/gift-dispenser/bot.env
cat > /etc/gift-dispenser/bot.env <<'ENV'
BOT_TOKEN=<the token BotFather gave you>
ADMIN_USER_ID=<your numeric Telegram user ID>
TZ=Europe/Berlin
ENV
chmod 0400 /etc/gift-dispenser/bot.env
```

Exclude `/var/lib/gift-dispenser/` from every host backup: it holds unencrypted keys until the wipe.

Then create the database and start the bot:

```sh
dispenser init
docker compose -f /opt/gift-dispenser/compose.yaml up -d
docker compose -f /opt/gift-dispenser/compose.yaml logs -f bot
```

## Running an event

| When | Steps |
|---|---|
| Before | Message the bot once from your admin account, so it may message you. Add the bot to the event group from your admin account and promote it to admin with every right switched off. Take the chat ID from the bot's "I'm now an admin" message. Copy `instructions.txt` to `~/event/` on the Pi, then run `ssh -t pi 'cd ~/event && dispenser event create --title "…" --group=<chat id> --opens "YYYY-MM-DD HH:mm" --closes "YYYY-MM-DD HH:mm" --instructions instructions.txt'`. Shortly before the event, from your laptop: `ssh pi 'dispenser import - --yes' < "gift codes.txt"`. Check with `dispenser status`. |
| During | `dispenser status`. On a breaker trip, check `status`, then `dispenser resume` or stay paused; rotate the passphrase with `ssh -t pi dispenser event passphrase` if strangers were in the burst. `dispenser unlock <id>` for a claimant who shows a lockout. |
| After | Claims close at `--closes`, or earlier with `dispenser event close`. From your laptop: `ssh pi dispenser export > unclaimed.txt`, and note the checksum it prints. Sweep the unclaimed funds with the dapp's Recover Funds tab, delete `unclaimed.txt`, then `dispenser wipe --checksum <sum>`. |
| Around day 7 | `dispenser checkin send` |
| Day 30 and after | `dispenser stats`. Then stop the bot with `docker compose -f /opt/gift-dispenser/compose.yaml down`; the database now holds no keys and can be archived. |

Run `dispenser` with no arguments for the list of commands.
~~~~

`docs/dry-run.md`:

~~~~markdown
# Dry run before the event

Run this once, a few days before the event, on the Pi.
It uses a second bot from BotFather, a throwaway group, and unfunded keys, plus one key funded with a little xDAI so `stats` can count a redemption.
Tick each line; stop and fix anything that does not behave as written.

## Setup

- [ ] Create a test bot with BotFather and put its token in a copy of `bot.env`.
- [ ] Create a throwaway group, add Rose, and turn its captcha on.
- [ ] `dispenser init`, then start the bot.
- [ ] Message the test bot from your admin account.
- [ ] Add the bot to the group and promote it with every right off: the bot messages you "I'm now an admin in …" with the chat ID.
- [ ] If the group became a supergroup, the ID in that message starts with `-100`; use that one.
- [ ] `dispenser event create … --group=<id> --passphrase-generate`, with the window open now.
- [ ] Import 6 unfunded keys and the one funded key.

## Claims

- [ ] From a second Telegram account that is not in the group: the passphrase gets "This is for members of …".
- [ ] Join the group but do not solve Rose's captcha: the passphrase gets "Finish the group's verification first, …". This confirms that an unverified member shows as `restricted` (spec §15).
- [ ] Solve the captcha: the passphrase now delivers a code, hidden as a spoiler, with the key in monospace inside it (spec §15).
- [ ] `/mycode` re-sends the same code.
- [ ] From a third account, send 5 wrong passphrases: the reply shows the account's ID; `dispenser unlock <id>` lets it try again.
- [ ] Claim from 6 accounts within a minute: the 6th gets "Claims are paused", and you get the 🔴 message; `dispenser resume` lifts it.
- [ ] `dispenser status` shows the claims, the breaker, the group check and the lockouts.

## After

- [ ] `dispenser event close`, then `dispenser export`: the output is only the unclaimed keys, one per line.
- [ ] Paste them into the dapp's Recover Funds tab: it accepts them.
- [ ] `dispenser wipe --checksum <sum>`; `/mycode` now says codes are no longer stored.
- [ ] `dispenser checkin send`; tap an answer in the check-in message.
- [ ] Use the funded key in a wallet to send one transaction, then `dispenser stats` counts one redemption.
- [ ] Remove the test bot's data directory before the real `dispenser init`.
~~~~

- [ ] **Step 4: Run all checks and build**

Run: `pnpm check`
Expected: the typecheck and lint print no errors, and Vitest ends with `Tests  113 passed (113)`.

Run: `pnpm build && ls dist/main.js`
Expected: `dist/main.js`.

- [ ] **Step 5: Smoke-test the compiled CLI**

```bash
D=$(mktemp -d)
export BOT_TOKEN=123456:AAAAAAAAAAAAAAAAAAAAAAAAAAA ADMIN_USER_ID=1 TZ=Europe/Berlin DATA_DIR=$D
node dist/main.js dispenser init
node dist/main.js dispenser status
BOT_TOKEN=bad node dist/main.js dispenser status; echo "exit=$?"
unset BOT_TOKEN ADMIN_USER_ID DATA_DIR; rm -rf "$D"
```

Expected, line by line: `created …/dispenser.db`, then `No event yet. Create one with "dispenser event create".`, then `error: BOT_TOKEN is missing or malformed` and `exit=1`.

- [ ] **Step 6: Build and smoke-test the image**

This needs Docker; on the Pi it builds natively for arm64.

```bash
docker build -t gift-dispenser:0.1.0 .
D=$(mktemp -d); chmod 777 "$D"
printf 'BOT_TOKEN=123456:AAAAAAAAAAAAAAAAAAAAAAAAAAA\nADMIN_USER_ID=1\nTZ=Europe/Berlin\n' > "$D.env"
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  --user 10001:10001 --env-file "$D.env" -v "$D:/data" gift-dispenser:0.1.0 dispenser init
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --user 10001:10001 \
  --env-file "$D.env" -v "$D:/data" gift-dispenser:0.1.0 dispenser status
rm -rf "$D" "$D.env"
```

Expected: the build ends without errors, then `created /data/dispenser.db` and `No event yet. Create one with "dispenser event create".`.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/cli/terminal.ts src/main.ts Dockerfile .dockerignore deploy/compose.yaml deploy/dispenser README.md docs/dry-run.md
git commit -s -m "feat: add the bot and cli entry points, image and deployment" -m "- run the bot with the runner, auto-retry, per-account ordering and a polling watchdog
- build a non-root image with no compiler
- add the compose file, the cli wrapper, the readme and the dry-run checklist"
```

After this task, run the dry run in `docs/dry-run.md` on the Pi before the event.
It covers the spec §15 checks that need real Telegram: the spoiler rendering, Rose's status for verified and unverified members, and the group ID after a supergroup upgrade.
