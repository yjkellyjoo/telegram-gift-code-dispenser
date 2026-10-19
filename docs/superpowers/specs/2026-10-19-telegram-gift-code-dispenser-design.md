# Telegram Gift Code Dispenser — Design

- **Date:** 2026-10-19
- **Status:** Draft for review

## 1. Purpose

Swarm hands out *gift codes* at events.
A gift code is a freshly generated Gnosis Chain private key, funded with xDAI and xBZZ by the [swarm-bzz-gift-code-dapp](https://github.com/w3rkspacelabs/swarm-bzz-gift-code-dapp).
A code may also own a *gift drive*: a postage batch bought by the gift wallet itself, so the recipient can upload to Swarm immediately.
Today codes reach people as printed QR cards.

This bot hands codes out over Telegram instead, at in-person and online events, to people who prove they are entitled to one.
A code is a bearer secret: whoever reads it owns the funds, and a handed-out code cannot be taken back.
The bot is not limited to private keys; it can dispense any list of secrets.

The bot also feeds a KPI: gift codes redeemed and used within 30 days of hand-out.
The KPI is reported as a funnel (handed out → redeemed → first upload) without extra tracking of the person.

## 2. Success criteria

1. No code is ever handed out twice.
2. No code is lost to a crash or a failed send: an assigned code can always be re-delivered while its event is open.
3. No regular claimant can obtain more than one code per event, or any part of the list, through the bot.
4. No secret, passphrase, or bot token ever appears in a log.
5. Every unclaimed code is recoverable after each event, so its funds can be swept with the dapp's Recover Funds tab.
6. The KPI funnel can be reported per event, as totals.

## 3. Scope

### In scope

- Per-event pools of imported codes, dispensed one per Telegram account per event.
- Per-event eligibility checks: Telegram group membership, a passphrase, or both.
- A scheduled event lifecycle, managed entirely from a CLI on the server.
- Circuit breakers that pause claiming on abnormal activity, lifted by the operator.
- Output-only alerts to an admin chat.
- KPI metrics: the bot's own funnel, on-chain activity of handed-out EVM keys, and one optional check-in message.

### Out of scope

- Generating or funding codes.
  The dapp does that, and the bot never holds a funded treasury wallet.
- One code per *human*.
  The bot guarantees one per Telegram account; who may join the event group is the per-person filter.
- Management through Telegram or a web UI.
- Detecting uploads on-chain, which is not possible (see §9.2).
- Protection against a fully compromised Pi.

## 4. Threat model

The adversary is anyone who can message the bot.
They may use many Telegram accounts, forge button data, replay old buttons, and flood the bot.

They must not be able to:

- obtain more than one code per account per event;
- obtain another account's code;
- obtain unclaimed codes, in whole or in part;
- learn a passphrase by guessing.

Accepted risks:

- **Telegram sees delivered codes.**
  Bot chats are not end-to-end encrypted, so every delivered code is stored on Telegram's servers.
- **Multiple accounts.**
  One person with several accounts that each pass the checks receives several codes.
- **Leaked passphrases.**
  Passphrases are never announced; staff tell them to one person at a time.
  A leaked passphrase still lets strangers claim, until the claim-burst breaker (§11) pauses the event or the operator rotates the passphrase.
  The operator can claw back codes claimed during the incident (§11.4).
- **Root or Docker access on the Pi** reveals everything.
  Only the operator has access to the Pi.

## 5. Decisions

| Topic | Decision |
|---|---|
| Audience | In-person and online events |
| Verification | Per event: group membership, passphrase, or both; at least one is required |
| Passphrase distribution | One shared passphrase per event, told privately to each person who asks; never announced |
| Circuit breaker | Per event: claim-burst and optional headcount trips; for all events: integrity trips; resumed by the operator |
| Code source | Imported pre-made codes; the bot never funds anything |
| Management | CLI only, run on the server |
| Host | The operator's Raspberry Pi 5 (8 GB, SSD), sole operator |
| Deployment | Hardened Docker Compose |
| Stack | TypeScript on Node.js LTS: grammY, better-sqlite3, ethers v6, pnpm, Vitest |
| Delivery | Tap-to-reveal spoiler plus the event's instructions; `/mycode` re-sends the same code until close |
| Secrets at rest | AES-256-GCM in SQLite; key in a file outside the data directory; unattended restarts |
| After close | Export unclaimed codes, then wipe every secret; the claim log stays |
| Alerts | Output only, to a private admin chat; optional external heartbeat |
| Metrics | Bot funnel, daily on-chain job, optional one-time check-in; totals only |
| Backups | No database backups; the secret-free journal is the only backup, and the original dapp exports are the backup of the secrets |

## 6. Architecture

```
                   Telegram (long polling, outbound only)
                              ▲
┌─────────────────────────────┼───────────────── Raspberry Pi 5 ──────┐
│  container: gift-dispenser  │                                       │
│                             │                                       │
│   bot/  claimant dialogue ──┘     cli/   operator commands          │
│   jobs/ scheduler (alerts, check-ins, on-chain, heartbeat)          │
│     │                               │                               │
│     ▼                               ▼                               │
│   core/     rules: event state, checks, claimOrGet, attempts        │
│   store/    SQLite: schema, migrations, queries                     │
│     └── store/bulk  bulk secret reads and wipe (CLI only)           │
│   vault/    key loading, seal/open, fingerprints                    │
│   codes/    parseCodes, labels, export formatting                   │
│   journal/  append and replay                                       │
│   alerts/   admin chat sender with dedupe                           │
│   chain/    block explorer client, transaction classification       │
│   clock     injected time source                                    │
│                                                                     │
│  /data (bind mount of /var/lib/gift-dispenser on the SSD)           │
│     dispenser.db, journal.jsonl                                     │
│  /run/secrets/vault_key  (from /etc/gift-dispenser/vault.key)       │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.1 Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `bot/` | Filters updates, runs the claim dialogue, renders messages, rate-limits accounts | `core`, `alerts`, grammY |
| `cli/` | Every operator command | `core`, `store`, `store/bulk`, `codes`, `journal`, grammY API (group checks) |
| `jobs/` | `runDueJobs(now)`: pre-flight, lifecycle and pool alerts, close reminders, check-ins, on-chain job, heartbeat, disk check | `core`, `store`, `chain`, `alerts` |
| `core/` | Domain rules; owns `claimOrGet(event, user)`, the only function in the bot process that returns a secret | `store`, `vault`, `journal`, `clock` |
| `store/` | SQLite access; the only code that writes SQL | better-sqlite3 |
| `store/bulk` | Reading many secrets (export) and wiping them | `store`, `vault` |
| `vault/` | `seal(plaintext, context)`, `open(blob, context)`, `fingerprint(secret)` | Node `crypto` |
| `codes/` | `parseCodes(text, format)`, labels, export formats | ethers |
| `journal/` | Durable append of state changes; replay on restore | Node `fs` |
| `alerts/` | Sends to the admin chat; deduplicates | grammY API |
| `chain/` | Fetches an address's transactions; classifies them | HTTP |

A lint rule (`no-restricted-imports`) rejects any import of `store/bulk` from `bot/`, `jobs/`, or `core/`.
CI runs lint, so the bot process cannot contain a code path that returns more than the caller's own code.

### 6.2 Deployment

One image, built on the Pi (arm64) in two stages, so the native SQLite module is compiled in the image and Node is not installed on the host.

```yaml
# /opt/gift-dispenser/compose.yaml
services:
  bot:
    image: gift-dispenser:<version>
    restart: unless-stopped
    user: "10001:10001"
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    mem_limit: 256m
    env_file: /etc/gift-dispenser/bot.env
    secrets: [vault_key]
    volumes:
      - /var/lib/gift-dispenser:/data
    logging:
      options: { max-size: "10m", max-file: "3" }
secrets:
  vault_key:
    file: /etc/gift-dispenser/vault.key
```

Host files:

| Path | Contents | Owner, mode |
|---|---|---|
| `/etc/gift-dispenser/vault.key` | 32 random bytes as 64 hex characters, made with `openssl rand -hex 32` | `10001`, `0400` |
| `/etc/gift-dispenser/bot.env` | `BOT_TOKEN`, `ADMIN_CHAT_ID`, `TZ`, optional `HEARTBEAT_URL`, optional `BLOCKSCOUT_URL` | `root`, `0400` |
| `/var/lib/gift-dispenser/` | `dispenser.db`, `journal.jsonl` | `10001`, `0700` |
| `/usr/local/bin/dispenser` | Wrapper around `docker compose exec` | `root`, `0755` |

The wrapper attaches a terminal only when stdin is a terminal.
Hidden passphrase prompts therefore work interactively, and piping works over SSH.

If the host's own backup routine covers `/var/lib/gift-dispenser/`, it must exclude `dispenser.db*`.
`journal.jsonl` holds no secrets and may be copied anywhere.

### 6.3 Telegram integration

- Long polling through `@grammyjs/runner`, processing one account's updates in order and different accounts in parallel.
- `allowed_updates` is `message`, `callback_query`, and `my_chat_member`.
- Messages and button taps are handled only from private chats.
  Every other chat is ignored, including the admin chat.
- `my_chat_member` updates from groups maintain the group registry (§7).
- 429 responses wait for Telegram's `retry_after` (grammY auto-retry).
- Each account may send 3 updates per 2 seconds; the bot drops the excess without replying.

## 7. Data model

SQLite, with `journal_mode=WAL`, `synchronous=FULL`, `secure_delete=ON`, `foreign_keys=ON`, and `busy_timeout=5000`.
All times are stored as UTC.

### `meta`

`schema_version`, `canary` (a known value sealed at `init` and opened at every start), the global breaker state (`global_paused_at`, `global_paused_reason`), `bot_started_at`, and `bot_heartbeat_at`, written by the bot every 30 seconds while polling succeeds.

### `events`

| Column | Meaning |
|---|---|
| `id`, `slug` | Slug is unique: lowercase letters, digits, and hyphens |
| `title` | Shown to claimants |
| `tz` | IANA time zone for input and display |
| `opens_at`, `closes_at` | The schedule; `opens_at < closes_at` |
| `closed_at` | Set by an early close |
| `group_chat_id`, `group_invite_link` | Group check, on when set; the link is required with the group |
| `passphrase_hash`, `passphrase_salt` | Passphrase check, on when set; scrypt |
| `max_attempts` | Default 5 |
| `message_template` | Operator-written Telegram HTML |
| `code_kind` | `evm-key` or `opaque`, fixed by the first import |
| `checkin_after_days` | Null means check-ins are off |
| `trip_rate_count`, `trip_rate_seconds` | Claim-burst limit; default 5 claims per 60 seconds |
| `expected` | Optional headcount; null means the headcount trip is off |
| `paused_at`, `paused_reason` | Set by an event breaker trip or a manual pause |
| `resumed_at` | Set by `event resume`; the burst window never reaches back past it |
| `suspended_at` | Set by a restore when the passphrase must be re-entered |
| `exported_at`, `wiped_at` | Lifecycle markers |

`CHECK (group_chat_id IS NOT NULL OR passphrase_hash IS NOT NULL OR suspended_at IS NOT NULL)`.

### `codes`

| Column | Meaning |
|---|---|
| `id`, `event_id` | |
| `payload` | Sealed JSON `{"secret": …, "batch": …}`; null after a wipe |
| `fingerprint` | `HMAC-SHA256(fingerprint key, canonical secret)`, hex |
| `label` | Checksummed address for `evm-key`; `fp:` plus 8 fingerprint hex characters for `opaque` |
| `claimed_by`, `claimed_username`, `claimed_at` | The claim log; survives the wipe |

`UNIQUE (event_id, claimed_by)`.
`UNIQUE (event_id, fingerprint)`.

### `attempts`

`(event_id, telegram_user_id)` → `failures`, `locked_at`, `last_username`.

### `groups`

`chat_id`, `title`, `bot_is_admin`, `updated_at`, maintained from `my_chat_member` updates.

### `funnel`

`(event_id, stage, telegram_user_id)` → `first_at`, one row per account per stage reached.
Stages: `picked`, `not_member`, `passed_group`, `locked_out`, `passed_passphrase`, `received`, `turned_away`, `turned_away_paused`.

### `code_activity`

One row per claimed code:

- Check-in: `checkin_status` (`sent`, `unreachable`), `checkin_sent_at`, `checkin_answer` (`uploaded`, `not_yet`, `stuck`), `checkin_reason` (`install`, `import`, `upload`, `other`), `checkin_answered_at`.
- On-chain: `chain_first_tx_at`, `chain_first_swarm_at`, `chain_first_moved_out_at`, `chain_checked_until`, `chain_done`.

## 8. Claim flow

### 8.1 States of an event

```
create ─► scheduled ─(opens_at)─► open ─(closes_at or close)─► closed ─(export + wipe)─► finalized
```

State is derived from timestamps on every read, never stored as a status.
An event is **open** when `opens_at ≤ now < closes_at`, `closed_at` is null, `suspended_at` is null, and `wiped_at` is null.
An open event **accepts claims** when, in addition, `paused_at` is null and the global breaker is clear (§11).
A paused event stays listed and keeps re-sending codes already assigned; it only stops assigning new ones.

### 8.2 Dialogue

```
/start, or any text while idle
  └─► list open events as buttons (or "No events are open right now.")
        │ tap (callback data: ev:<event id>)
        ▼
  event open? ─ no ─► "<title> has closed."
        │
  account already has a code here? ─ yes ─► re-send it (done)
        │
  accepting claims? ─ no ─► "Claims for <title> are paused. Please check back soon."
        │
  group check on? ─ yes ─► member? ─ no ─► "Join <title>'s group first: <link>"
        │                    │ lookup failed ─► "I couldn't check your membership. Try again in a minute."
        ▼                    ▼
  unclaimed codes left? ─ no ─► "All codes for <title> have been claimed."
        │
  passphrase check on? ─ yes ─► locked? ─ yes ─► "Too many wrong tries. Ask the organizers for help."
        │                         │
        │                  "Send the event passphrase."
        │                         ├─ wrong ─► "That's not it. <n> tries left."
        │                         │            (locks at max_attempts)
        ▼                         ▼ right
  claimOrGet(event, account) ─► open that one payload ─► send
```

- Membership means status `creator`, `administrator`, or `member`, or `restricted` with `is_member = true`.
- The pending-passphrase state is held in memory per account, expires after 10 minutes, and is lost on restart; the account picks the event again.
- Every step re-reads the event from the database; nothing decided in an earlier step is trusted.
- `/mycode` re-sends the account's codes for every event that is still open, or replies "You don't have a code for an open event."
- Funnel stages (§7) are recorded as the account reaches them.

### 8.3 Input rules

- Identity comes only from the update's `from.id`.
- Callback data must match `ev:<int>`, `ci:<int>:<answer>`, or `cr:<int>:<reason>` exactly.
  Anything else gets an empty `answerCallbackQuery` and nothing more.
- A check-in button counts only when `from.id` equals the code's `claimed_by`.
- Passphrases are normalized before comparison: Unicode NFKC, trimmed, internal whitespace collapsed to one space, lowercased.
  Comparison is constant-time against the scrypt hash.
- No claimant text is stored, echoed, inserted into a template, or used in SQL other than as a bound parameter.

### 8.4 `claimOrGet`

One `BEGIN IMMEDIATE` transaction:

1. If `(event, account)` already has a code, return it.
2. Re-check that the event is open and accepting claims.
3. Evaluate the event's trips (§11.1).
   If assigning one more code would break a limit, pause the event instead and return "paused".
4. Assign the unclaimed, unwiped code with the lowest `id` to the account.

It returns at most one sealed payload, or "pool empty", "paused", or "closed".
The `UNIQUE (event_id, claimed_by)` constraint backs it up; if that constraint ever rejects a claim, the global breaker trips (§11.2).

After commit, the claim is appended to the journal (§14.2) before the message is sent.

### 8.5 Delivery

The operator's template may use `{event}`, `{code}`, `{address}`, `{batch}`, and `{closes}`.
`{code}` renders as `<tg-spoiler><code>…</code></tg-spoiler>`.
Every inserted value is HTML-escaped.
The bot appends: "Lost this message? Send /mycode until {closes}."

The CLI validates a template when it is set:

- `{code}` must be present.
- Only known placeholders are allowed.
- The HTML must be well-formed and use only tags Telegram supports.
- `{address}` requires `code_kind = evm-key`.
- `{batch}` requires every code in the event to carry a batch.

Imports re-check the last two rules.

### 8.6 Failure handling in the flow

Every failure fails closed: no code is sent, and the claimant gets a generic message.

| Failure | Claimant sees | Also |
|---|---|---|
| Membership lookup error | "Try again in a minute" | Counted toward the Telegram-failure alert |
| Decryption failure | "Something went wrong. The organizers have been told." | Global breaker trips (§11.2) |
| Journal append failure | Same | Global breaker trips (§11.2) |
| Template render or Telegram HTML error | Same | 🔴 alert |
| Send fails | Nothing new | Up to 3 retries with backoff; the assignment stands, so the next tap re-sends |
| Account blocked the bot | Nothing | No retry |

## 9. Metrics

### 9.1 Bot funnel

From the `funnel` table: unique accounts that picked the event, passed the group check, passed the passphrase, and received a code.
Drop-outs are counted separately: not a member, locked out, turned away by an empty pool, or turned away by a pause.
A check that is off for an event shows as `n/a`.

### 9.2 On-chain activity

Only for `evm-key` codes, by address only.

The job runs daily at 03:00 in `TZ`.
It covers each claimed code until 30 days after `claimed_at`, then makes one final pass and sets `chain_done`.
It fetches the address's transactions and token transfers from Gnosis Chain's Blockscout API.

Only outgoing transactions after `claimed_at` count.
Gift-drive wallets send two transactions (approve, then `createBatch`) before hand-out, and those must not count as redemption.

| Milestone | Definition |
|---|---|
| Redeemed | First outgoing transaction after `claimed_at` |
| Used on Swarm | First transaction to the PostageStamp contract (`0x45a1502382541Cd610CC9068e88727426b696293`) or to the Bee chequebook factory, or an xBZZ transfer into the address's own chequebook |
| Moved out | First outgoing xDAI or xBZZ transfer to an address that is not a Swarm contract or the address's own chequebook |

The report counts "used on Swarm" and "moved out without Swarm use" separately, so cash-outs do not inflate adoption.

Uploads cannot be seen on-chain.
Chunks are stamped off-chain, and nothing public ties a chunk to a batch.

### 9.3 Check-in

When `checkin_after_days` is set, the scheduler sends one message to each claimant that many days after `claimed_at`:

```
Hi! <n> days ago you got a Swarm gift code at <title>.
Did you upload your first file?
[ Yes ]  [ Not yet ]  [ I'm stuck ]
```

"I'm stuck" follows up with one tap: Installing Bee, Importing the key, Uploading, or Something else.

- `checkin_status = sent` is written before sending, so the message goes out at most once.
- A 403 from Telegram sets `unreachable`.
- Answers count until 30 days after `claimed_at`; a later answer replaces an earlier one.
- Answers are one tap only; no free text is collected.

### 9.4 Reading metrics

`dispenser stats [<slug>]` prints totals per event:

```
ETHRome 2026 Workshop                         window: 30 days
─────────────────────────────────────────────────────────────
Bot      picked event 142 → passed group 131 → passed phrase 118 → received 118
         not a member 11 · locked out 2 · turned away: pool empty 0, paused 3
Chain    redeemed 71 (60%) · used on Swarm 58 (49%) · moved out only 9 (8%)
Check-in sent 118 · answered 64 · uploaded 41 · not yet 12 · stuck 11
         stuck at: installing Bee 6 · importing key 3 · uploading 1 · other 1
```

`--csv` writes the same figures, one row per event.
No metrics output ever lists individual accounts or addresses.

## 10. Admin alerts

Alerts go to `ADMIN_CHAT_ID`, a private chat containing only the operator.
The bot never reads that chat.
No alert contains a secret; codes appear only by label.
Each `(alert kind, event)` pair is sent at most once per 15 minutes.

| Moment | Level |
|---|---|
| An event breaker trips, with the reason, the numbers, and the commands to inspect and resume (§11.3) | 🔴 |
| The global breaker trips, with the cause | 🔴 |
| Pre-flight fails one hour before `opens_at` | 🔴 |
| The bot is removed from, or loses admin in, a group an unfinalized event uses | 🔴 |
| The pool is empty while the event is open; repeated hourly with the count of accounts turned away | 🔴 |
| 5 or more failed membership lookups or sends within 5 minutes | 🔴 |
| 3 or more restarts within 10 minutes | 🔴 |
| 50% and 80% of the pool claimed, with time since opening | 🟡 |
| 3 or more accounts locked out of one event within 10 minutes; with one-on-one hand-out this suggests guessing, or staff giving out the wrong passphrase | 🟡 |
| Event closed, with claimed and unclaimed counts; repeated daily until wiped | 🟡 |
| Bot started while an event is open | 🟡 |
| Bot started otherwise | ⚪ |
| Data filesystem over 90% full, checked every 10 minutes | 🟡 |
| On-chain job failed 3 days in a row | 🟡 |
| Event opened, with pool size and checks | ⚪ |
| A breaker is resumed by the operator | ⚪ |

When `HEARTBEAT_URL` is set, the bot requests it every 60 seconds while polling is healthy.
An external service, such as healthchecks.io, then reports when the Pi or its network is down, which the bot cannot report itself.

## 11. Circuit breaker

Passphrases are handed out one person at a time, so honest claims arrive slowly and steadily.
A burst is therefore abnormal by definition, and the breaker can be tight without turning honest people away.

A tripped breaker stops new assignments only.
Re-sends of codes already assigned keep working, because they reveal nothing new and do not touch the pool.
Claimants who try to claim see "Claims for <title> are paused. Please check back soon."

### 11.1 Event trips

Evaluated inside `claimOrGet`, before a code is assigned:

| Trip | Rule | Default |
|---|---|---|
| Claim burst | Assigning would make more than `trip_rate_count` claims within the last `trip_rate_seconds` | 5 per 60 seconds, set with `--trip-rate <n>/<seconds>` |
| Headcount | Assigning would make more than `expected` claims in total | Off; set with `--expected <n>` |

A trip sets `paused_at` and `paused_reason`, appends `event.paused` to the journal, and raises a 🔴 alert.
The claim that triggered it is refused.
`dispenser event pause <slug>` trips the same breaker by hand.

### 11.2 Global trips

These indicate a bug, tampering, or a broken host, so they stop claims in every event:

| Trip | Clears |
|---|---|
| The `UNIQUE (event_id, claimed_by)` constraint rejects a claim | `dispenser resume --all` |
| Any payload fails to decrypt | `dispenser resume --all` |
| A journal append fails | `dispenser resume --all` |
| The clock reads earlier than the newest journal entry, e.g. after a power cut and before the Pi's clock syncs | By itself: the scheduler clears it on its first run after the clock passes that entry |

A trip sets `global_paused_at` and `global_paused_reason`, appends `breaker.tripped` to the journal when the journal is writable, and raises a 🔴 alert.
The bot keeps the newest journal timestamp in memory, read at start and updated on every append, so the clock check costs nothing per claim.

### 11.3 Inspecting a trip

The alert names the trip, the numbers, and the next commands:

```
🔴 ETHRome 2026 Workshop: claims paused
Claim burst: a 6th claim 38 s after the 1st (limit 5 per 60 s), 14:31:05–14:31:43
Re-sends of existing codes still work.
Inspect: dispenser event show ethrome-2026
Resume:  dispenser event resume ethrome-2026
```

`dispenser status` is the one-screen overview:

```
Bot       polling OK (last update 3 s ago) · up 2 d 4 h
Breaker   global: clear
Events    ethrome-2026   PAUSED (claim burst)   pool 61/120 left   last claim 14:31:38
          scc-oct        open                   pool 18/40 left    last claim 12:02:10
```

For a global trip, `status` shows the cause instead, e.g. `journal write failed: ENOSPC`, `decryption failed: code 0x77b2…1d4e`, or `waiting for clock: now 14:02, last journal 14:31`.

`dispenser event show <slug>` adds the breaker detail.
It is the one place the CLI shows individual claims, because judging a trip needs them:

```
Breaker   PAUSED since 14:31:43
          claim burst: a 6th claim 38 s after the 1st (limit 5 per 60 s)
          turned away while paused: 3 accounts

Claims in the trip window
  14:31:05  @alice       123456789   0x3fA1…92c0
  14:31:09  (no name)    987654321   0x77b2…1d4e
```

### 11.4 Responding

| Situation | Response |
|---|---|
| False alarm, e.g. a group the staff served together | `dispenser event resume <slug>`; raise the limit with `event edit <slug> --trip-rate <n>/<seconds>` if it will recur |
| Leak: strangers in the trip window | Rotate the passphrase with `event edit <slug> --passphrase`, optionally claw back, then resume |
| Global trip | Fix the cause, then `dispenser resume --all` |

**Claw-back.**
`dispenser export <slug> --claimed-between <from> <to>` writes the keys of codes claimed in that window to stdout.
The operator pastes them into Recover Funds and sweeps the funds before the strangers use them.

- It requires a paused or closed, unwiped event.
- `<from>` and `<to>` are `YYYY-MM-DD HH:mm:ss`, or `HH:mm:ss` for today, in the event's time zone; both ends are inclusive.
- It appends `export.claimed` (event, window, count) to the journal.
- It sweeps every claim in the window, honest ones included.
- For gift-drive codes it recovers the funds, but not the postage batch, which stays owned by the key.

### 11.5 Resuming

- `dispenser event resume <slug>` shows the trip reason, asks for confirmation, clears `paused_at`, and appends `event.resumed`.
  The burst window then restarts empty, so the claims that caused the trip cannot trip it again.
- `dispenser resume --all` re-checks every global condition before clearing.
  It checks that the canary opens, every live payload decrypts, the journal accepts a test append, and the clock is not behind the newest journal entry.
  If any check fails, it refuses and names the failure.
- Every resume raises a ⚪ alert.

## 12. CLI and event lifecycle

### 12.1 Commands

```
dispenser init                          create the database and the canary; refuses if they exist
dispenser status                        bot health, global breaker, every unfinalized event
dispenser groups                        groups the bot is in, and whether it is an admin

dispenser event create <slug> --title <text>
    --opens "YYYY-MM-DD HH:mm" --closes "YYYY-MM-DD HH:mm" [--tz <IANA zone>]
    [--group <chat id> --invite-link <url>]
    [--passphrase | --passphrase-generate] [--max-attempts <n>]
    [--trip-rate <n>/<seconds>] [--expected <n>]
    --template <file> [--checkin-after <days>]
dispenser event edit <slug> <any create flag> [--no-group] [--no-passphrase] [--no-expected]
dispenser event list
dispenser event show <slug>
dispenser event check <slug>
dispenser event close <slug>
dispenser event pause <slug>
dispenser event resume <slug>
dispenser resume --all

dispenser import <slug> <file|-> [--format gift-codes|lines] [--yes]
dispenser export <slug> [--format keys|table] [--claimed-between <from> <to>]
dispenser wipe <slug> --checksum <sum>
dispenser restore --journal <file>
dispenser unlock <slug> <telegram id|@username>
dispenser stats [<slug>] [--csv]
```

`status` reports polling health from a heartbeat the bot writes to the `meta` table every 30 seconds.

### 12.2 Rules

- `--tz` defaults to `TZ`.
- `--passphrase` reads from a hidden prompt and refuses to run without a terminal.
- `--passphrase-generate` picks 3 words from the EFF short word list (about 31 bits) and prints them once.
- Every create and edit keeps at least one check on; the CLI refuses otherwise, and the `CHECK` constraint backs it up.
- `--group` requires the group to be in the registry with `bot_is_admin`, confirmed live against Telegram.
- Edits are allowed until the event is wiped.
  `opens_at` can change only before the event opens.
  Extending `closes_at` on a closed event reopens it.
- Editing the passphrase clears `suspended_at`.
- `--trip-rate` takes `<n>/<seconds>` with `n ≥ 1` and seconds from 10 to 3600.
- `--expected` must be at least 1; `--no-expected` turns the headcount trip off.
- `event pause` works on any unwiped event, including one not yet open.
  `event resume` works only on a paused event.
- `event check` runs pre-flight: codes imported, a valid group if set, a valid template, `opens_at < closes_at`, and the canary opens.
  Pre-flight also runs on create, on edit, and automatically one hour before `opens_at`.
- `unlock` resets one account's failures; `@username` is matched against `attempts.last_username`.

### 12.3 Import

`import` is a dry run unless `--yes` is given.
Both report: codes parsed, duplicates within the file, codes skipped, and any errors.

`--format gift-codes` (the default) accepts exactly what the dapp's `parseGiftDriveList` accepts:

- bare keys separated by commas, newlines, or tabs;
- the dapp's tab-separated table with its `privateKey address batchId` header;
- one JSON payload per line, `{"v":1,"pk":"0x…","batch":"0x…"}`.

Keys must be valid secp256k1 private keys as ethers v6 parses them, and are stored in canonical lowercase `0x` form.
In a table row, the address must match the key, or the import aborts.

`--format lines` treats each trimmed, non-empty line as one opaque secret of at most 1,000 characters.

The import aborts on:

- a duplicate within the file;
- an invalid key;
- an address mismatch;
- a format that contradicts the event's `code_kind`;
- a code without a batch when the template uses `{batch}`.

The import skips, and reports, any code that:

- is unclaimed and unwiped in another event; or
- was ever claimed, matched by fingerprint, or by address for EVM keys.

Skipping is what makes re-importing after a restore safe.
It never causes a code to be issued twice.

### 12.4 Export and wipe

- `export` requires a closed, unwiped event and writes the unclaimed codes to stdout:
  - `--format keys` (the default for `evm-key`): one canonical key per line, ready to paste into Recover Funds.
  - `--format table`: the dapp's tab-separated table, which keeps batch IDs, for carrying gift drives into a later event.
    It must not be pasted into Recover Funds, which would read addresses and batch IDs as keys.
  - `opaque` events export one secret per line.
- `export` writes to stderr: `checksum: <16 hex> (<n> codes)`.
  The checksum is the SHA-256 of the sorted unclaimed fingerprints, newline-joined.
- `wipe` requires a closed event and a checksum that matches the current unclaimed set.
  If a code was claimed after the export, the checksum no longer matches and nothing is deleted.
- `wipe` sets every payload in the event to null and sets `wiped_at`.
  It then runs `VACUUM` and `wal_checkpoint(TRUNCATE)`, and appends `event.wiped` to the journal.

Typical use from a laptop, so keys never sit in a file on the Pi:

```sh
ssh pi 'dispenser import ethrome-2026 - --yes' < "ETHRome 2026 - gift codes.txt"
ssh pi 'dispenser export ethrome-2026' > "ETHRome 2026 - unclaimed.txt"
ssh pi 'dispenser wipe ethrome-2026 --checksum 1a2b3c4d5e6f7a8b'
```

## 13. Secrets handling

### 13.1 Keys

The vault key file holds 32 bytes as 64 hex characters.
HKDF-SHA256 derives two subkeys from it:

- `enc`, for AES-256-GCM;
- `fp`, for HMAC-SHA256 fingerprints.

A keyed fingerprint keeps short opaque secrets, such as voucher codes, from being recovered by guessing.

At start, the bot opens the canary.
If the key is wrong or damaged, it refuses to start and alerts.

### 13.2 Encryption at rest

- `seal` produces `0x01 ‖ nonce (12 bytes, random) ‖ ciphertext ‖ tag (16 bytes)`.
- The associated data is `event:<event id>|fp:<fingerprint>`, so a ciphertext moved to another row or event fails to open.
- Plaintext exists only inside `claimOrGet` (one code) and inside `export`, and is never cached.

### 13.3 Logs

- Log lines carry the event slug, the Telegram user ID, and code labels.
- They never carry a payload, a passphrase attempt, the bot token, or the text of an incoming message.
- The error handler logs an update's ID and type, never its contents.
- The logger also scrubs the bot token by value.

### 13.4 Supply chain

- Runtime dependencies are grammY and its runner and auto-retry plugins, better-sqlite3, ethers, and a logger, pinned by the lockfile.
- All cryptography comes from Node's built-in `crypto`.
- The image contains no secrets.

## 14. Reliability

### 14.1 Durability of a claim

- `synchronous=FULL` ensures a committed claim survives a power cut.
  A rolled-back claim could otherwise re-issue a code that was already sent.
- Order per claim: commit, then journal append (fsync), then send.
  A crash at any point leaves at worst a code that was assigned but not sent, which the next tap or `/mycode` delivers.
- If the journal append fails, the code is not sent and the global breaker trips (§11.2).

### 14.2 Journal

`/data/journal.jsonl` is append-only, with one JSON object per line and an fsync after each append.
It holds no secrets.

| Entry | Fields |
|---|---|
| `event.created`, `event.edited` | All event fields except the passphrase hash and salt; `passphrase` is `set`, `cleared`, or omitted |
| `event.closed`, `event.wiped` | `event` |
| `code.claimed` | `event`, `fingerprint`, `label`, `user`, `username`, `at` |
| `attempts.locked`, `attempts.unlocked` | `event`, `user` |
| `event.paused`, `event.resumed` | `event`, `reason` |
| `breaker.tripped`, `breaker.resumed` | `reason` |
| `export.claimed` | `event`, `from`, `to`, `count` |
| `checkin.sent`, `checkin.answered` | `code fingerprint`, answer fields |

### 14.3 Restore

`dispenser restore --journal <file>` runs against a freshly initialized, empty database that uses the original vault key.

1. It recreates events.
   An event that had a passphrase comes back suspended until `event edit --passphrase`, so it can never reopen with weaker checks than configured.
2. It replays claims as payload-less claimed codes, along with lockouts, pauses, the global breaker state, and check-ins.
   A restore never silently lifts a pause or a global trip.
3. The operator then re-imports the original exports.
   The import skips every code the journal shows as claimed.

Funnel counts are not journaled and restart from zero after a restore.
On-chain progress is recomputed from the chain.

If the vault key itself is lost, fingerprints change.
EVM keys are still matched by address.
Opaque codes from events with claims cannot be matched, and must not be re-imported.

### 14.4 Process

- `restart: unless-stopped`, with Docker enabled at boot.
- An unhandled error exits the process.
- If polling has not succeeded for 3 minutes, the process exits.
- On `SIGTERM`, the bot stops polling, waits up to 10 seconds for in-flight updates, and closes the database.
- Startup order: load the key, open the database, check `schema_version`, open the canary, start polling, send the start alert.
- Migrations are numbered SQL files.
  The bot and the CLI both refuse a schema version they don't expect.
- `jobs/` runs `runDueJobs(now)` every minute.
  Every job is idempotent.

## 15. Testing

Vitest, with tests beside the code as `*.test.ts`, written test-first in vertical slices.
Each test is watched failing before code is written to pass it, and the full suite runs green after each slice.
No test uses a funded key; fixtures are random keys.

### 15.1 Seams

Tests drive the code only through these five agreed entry points:

| Seam | Entry point | Faked boundaries | Real |
|---|---|---|---|
| Bot | `handleUpdate(update)` on a bot built over a temp data directory | Telegram transport, clock | Core, SQLite, vault, journal |
| CLI | `runCli(argv, stdin)` → stdout, stderr, exit code | Telegram, clock, randomness | Everything else |
| Scheduler | `runDueJobs(now)` | Telegram, block explorer, clock | Everything else |
| Vault | `seal(plaintext, context)`, `open(blob, context)` | none | all |
| Import parser | `parseCodes(text, format)` → codes or line errors | none | all |

- "Restart" in a test means building a new bot over the same data directory.
- The Telegram fake intercepts grammY's outgoing calls at the transport.
  Tests check what users would see (which code, which message), not call sequences.
  Fake updates are complete, real-shaped payloads built from grammY's types.
- Expected values come from outside the code under test.
  Examples: the well-known Hardhat account #0 key mapped to `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, literal checksums, and frozen copies of real dapp exports.

### 15.2 Guarantees

| Guarantee | Seam and scenario | Break it catches |
|---|---|---|
| One code per account | Bot: 50 concurrent correct answers from one account → every reply carries the same code, and the next account gets a different one | Claim check outside the transaction |
| Never twice | Bot: 200 accounts against 100 codes → 100 distinct codes, 100 "all claimed" replies | Assignment not excluding claimed codes |
| No way to the list | Bot: forged button data, foreign check-in buttons, group-chat updates → never more than the caller's own code | Handlers trusting button data, or replying in groups |
| Fails closed | Bot: lookup error, broken template → no code sent, and an alert | An error path falling through to the send |
| Burst trip | Bot: 5 accounts claim within 60 seconds → the 6th is refused as paused, with an alert; the first 5 still get re-sends | Trip counted after assigning; off-by-one; a pause that blocks re-sends |
| Headcount trip | Bot: `expected` 3 → the 4th claim is refused as paused | Comparing with `≤` instead of `<` |
| Resume restarts the window | CLI `event resume` → the next claim succeeds although 5 claims sit inside the last 60 seconds | Window ignoring `resumed_at` |
| Global trip | Bot: a corrupted row → no event assigns new codes; CLI `resume --all` refuses while the row still fails to decrypt | Per-event scope; resume without re-checking |
| Clock behind | Bot: clock set before the newest journal entry → no claims; clock advanced past it → claims resume with no operator action | Missing check; requiring a manual resume |
| Restore keeps pauses | CLI: restore a journal with a paused event and a global trip → both still in force | Replay skipping breaker entries |
| Claw-back | CLI: `export --claimed-between` → exactly the keys claimed in that window; refused for an open, unpaused event | Window bounds off by one; missing state check |
| Brute force capped | Bot: the 6th guess is refused; still locked after a restart; CLI `unlock` lifts it | In-memory counter; off-by-one |
| No secrets in logs | Bot: success and error paths with captured logs → no code, passphrase, or token appears | Logging an update or an error's context |
| Send failure | Bot: send fails 3 times → the next tap delivers the same code | Rolling back or reassigning on send failure |
| Wrong key | Bot: start with a different key → refuses to start, and an alert | Canary check skipped |
| Restore never re-issues | CLI and Bot: claim → delete database → `restore` → re-import → the bot hands out only unclaimed codes | Journal written after the send; replay gaps |
| Restore never weakens checks | CLI: restore an event that had a passphrase → it is not listed until the passphrase is re-entered | Restoring as group-only or check-less |
| Wipe leaves no residue | CLI: `export` → `wipe` → the database file bytes contain none of the ciphertexts | `secure_delete` off; write-ahead log not truncated |
| Stale checksum refused | CLI: a claim between `export` and `wipe` → wipe refuses, and nothing is deleted | Checksum ignored |
| Redeemed counts only after hand-out | Scheduler: a gift-drive address with pre-hand-out approve and `createBatch` → not redeemed | Counting all outgoing transactions |
| Moved ciphertext fails | Vault: seal with context A, open with B → error | Associated data omitted |
| Dapp formats parse | Parser: frozen `.txt`, `.tsv`, and JSON payload fixtures plus malformed rows → literal expected codes and errors | Parser regressions |

Before a test file is called done, a mutation check runs: change a constant, flip a branch, or drop a side effect, and confirm that some test fails.

### 15.3 Acceptance

Before the first real event, a documented dry run uses a second bot from BotFather, a throwaway group, and unfunded keys.
It walks the full lifecycle: create, pre-flight, claim, lockout, close, export, wipe, and restore from the journal.

## 16. To verify during planning

Each item has a fallback, so none blocks the design.

| Assumption | Fallback if it does not hold |
|---|---|
| A Bee light node deploys a chequebook from its wallet on first start, and the factory address on Gnosis is known | "Used on Swarm" for gift-drive codes counts PostageStamp transactions only (top-ups, dilutions), and the report says so |
| Telegram renders `<code>` nested inside `<tg-spoiler>` | Render `{code}` as `<tg-spoiler>` only |
| Blockscout's Gnosis API serves per-address transactions and token transfers within its rate limits for a daily job | Use RPC only: a daily `eth_getTransactionCount` snapshot gives "redeemed" at day resolution, without classification |
