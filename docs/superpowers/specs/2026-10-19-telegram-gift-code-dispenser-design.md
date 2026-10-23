# Telegram Gift Code Dispenser — PoC Design

- **Date:** 2026-10-20
- **Status:** Draft for review
- **Scope:** the smallest working dispenser for one in-person event.
  Features beyond it are listed in §16 and get added one at a time.
  The earlier full design is kept in commit `6211710` for reference.

## 1. Purpose

Swarm hands out *gift codes* at events.
A gift code is a freshly generated Gnosis Chain private key, funded with xDAI and xBZZ by the [swarm-bzz-gift-code-dapp](https://github.com/w3rkspacelabs/swarm-bzz-gift-code-dapp).
A code is a bearer secret: whoever reads it owns the funds, and a handed-out code cannot be taken back.

This bot hands codes out over Telegram at one in-person event.
Staff tell the event passphrase to one person at a time.
To claim, a person must also be a member of the event's Telegram group.

The bot also feeds a KPI: gift codes redeemed and used within 30 days of hand-out.
The KPI is reported as a funnel (handed out → redeemed → first upload) without extra tracking of the person.

## 2. Success criteria

1. No code is ever handed out twice.
2. No code is lost to a crash or a failed send: an assigned code can be re-delivered until the wipe.
3. No regular claimant can obtain more than one code, or any part of the list, through the bot.
4. Only members of the event group who send the passphrase can claim.
5. No key, passphrase, or bot token ever appears in a log.
6. Every unclaimed code is recoverable after the event, so its funds can be swept with the dapp's Recover Funds tab.
7. The KPI funnel can be reported as totals.

## 3. Scope

### In scope

- One event per database, with one pool of imported plain gift codes, dispensed one per Telegram account.
- Two checks, both required: membership of the event's Telegram group, and a passphrase.
- A scheduled event window, managed from a CLI on the Pi.
- A claim-burst circuit breaker, lifted by the admin.
- Messages to the admin for breaker trips and for changes to the bot's status in groups.
- KPI metrics: an on-chain lookup of claimed addresses, one check-in message, and the bot's own numbers.

### Out of scope

- Generating or funding codes.
  The dapp does that, and the bot never holds a funded treasury wallet.
- One code per *human*.
  The bot guarantees one per Telegram account.
- Management through Telegram or a web UI.
- Detecting uploads on-chain, which is not possible (§10.2).
- Protection against a fully compromised Pi.

## 4. Threat model

The adversary is anyone who can message the bot.
They may use many Telegram accounts, forge button data, flood the bot, find the passphrase online, and join the event group through its public invite link.

They must not be able to:

- obtain more than one code per account;
- obtain another account's code;
- obtain unclaimed codes, in whole or in part;
- claim without being a member of the event group;
- learn the passphrase by guessing.

Accepted risks:

- **Telegram sees delivered codes.**
  Bot chats are not end-to-end encrypted, so every delivered code is stored on Telegram's servers.
- **Multiple accounts.**
  One person with several accounts that each pass the checks receives several codes.
- **Leaked passphrase plus the public invite link.**
  Rose's captcha keeps bots out of the group, but not a human who got the passphrase second-hand.
  The claim-burst breaker (§9) catches a rush, `event passphrase` rotates the passphrase, and the small pool caps the loss.
- **Unencrypted keys on the Pi.**
  Keys sit in plain text in SQLite between import and wipe.
  Anyone with root or Docker access on the Pi, or with the SSD, can read them in that window.
  Only the admin has access to the Pi, and the window is kept short: import shortly before the event, sweep and wipe soon after.
- **Leftover bytes on the SSD.**
  An SSD cannot guarantee that wiped data is gone.
  By then the unclaimed codes have been swept, so leftover keys hold empty wallets or belong to claimants.
- **No backups.**
  If the database is lost, the claim log is lost with it (§13).

## 5. Decisions

| Topic | Decision |
|---|---|
| Audience | One in-person event |
| Verification | Both required: membership of the event's Telegram group, and a passphrase |
| Passphrase distribution | One shared passphrase, told privately to each person; never announced |
| Group admission | Public invite link; the group runs Rose with a captcha |
| Circuit breaker | Claim burst, default 5 claims per 60 seconds; manual pause; resumed by the admin |
| Code source | Plain gift codes, exported by the dapp as bare keys; no gift drives |
| Management | CLI only, run on the Pi |
| Host | The admin's Raspberry Pi 5 (8 GB, SSD); the admin is the sole operator |
| Deployment | Hardened Docker Compose |
| Stack | TypeScript on Node.js LTS: grammY, better-sqlite3, ethers v6, pnpm, Vitest |
| Delivery | Tap-to-reveal spoiler with a button that copies the key, the event's instructions, and a link to the code's balance; `/mycode` re-sends the same code until the wipe |
| Keys at rest | Plain text in SQLite, readable only by the container user; kept for a short window |
| After close | Export unclaimed keys, sweep them with Recover Funds, then wipe every key; the claim log stays |
| Admin messages | Breaker trips and the bot's status in groups, sent to the admin's private chat |
| Metrics | On-chain lookup when `stats` runs, one check-in sent by hand, and bot numbers from existing tables; totals only |
| Backups | None; the database is excluded from host backups |

## 6. Architecture

```
          Telegram Bot API  (long polling, outbound only)
               │ updates                 ▲ sendMessage, getChatMember, leaveChat
┌──────────────▼──────────── Raspberry Pi 5 ───────────────────────┐
│  container: gift-dispenser                                       │
│                                                                  │
│   bot/   updates from private chats, group status changes        │
│   cli/   admin commands  ──────────────────────► Blockscout API  │
│     │                                                            │
│     ▼                                                            │
│   core/      rules: event state, checks, claimOrGet, breaker     │
│   store/     SQLite: schema, migrations, queries                 │
│     └── store/bulk  reading all keys (export) and wipe; CLI only │
│   codes/     parseCodes: bare keys → keys and addresses          │
│   chain/     Blockscout client: an address's transactions        │
│   clock      injected time source                                │
│                                                                  │
│  /data (bind mount of /var/lib/gift-dispenser on the SSD)        │
│     dispenser.db                                                 │
└──────────────────────────────────────────────────────────────────┘
```

### 6.1 Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `bot/` | Filters updates, rate-limits accounts, runs the claim flow, renders replies, handles group status changes | `core`, grammY |
| `cli/` | Every admin command | `core`, `store`, `store/bulk`, `codes`, `chain`, grammY API |
| `core/` | Domain rules; owns `claimOrGet(event, user)`, the only function in the bot process that returns a key | `store`, `clock` |
| `store/` | SQLite access; the only code that writes SQL | better-sqlite3 |
| `store/bulk` | Reading every unclaimed key (export) and wiping keys | `store` |
| `codes/` | `parseCodes(text)` → keys with addresses, or line errors | ethers |
| `chain/` | Fetches an address's outgoing transactions from Blockscout | HTTP |

A lint rule (`no-restricted-imports`) rejects any import of `store/bulk` from `bot/` or `core/`.
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
    volumes:
      - /var/lib/gift-dispenser:/data
    logging:
      options: { max-size: "10m", max-file: "3" }
```

Host files:

| Path | Contents | Owner, mode |
|---|---|---|
| `/etc/gift-dispenser/bot.env` | `BOT_TOKEN`, `ADMIN_USER_ID`, `TZ`, optional `BLOCKSCOUT_URL` (default `https://gnosisscan.io`, where `gnosis.blockscout.com` now redirects) | The admin's login user, `0400`; Docker Compose reads it on the host as that user |
| `/var/lib/gift-dispenser/` | `dispenser.db` | `10001`, `0700` |
| `/usr/local/bin/dispenser` | Wrapper around `docker compose run --rm bot dispenser …` | `root`, `0755` |

`ADMIN_USER_ID` is the admin's own Telegram user ID.
It is also the ID of the admin's private chat with the bot, where admin messages go.

The wrapper uses `run --rm`, so CLI commands work whether or not the bot is running.
It attaches a terminal only when stdin is a terminal.
Hidden passphrase prompts therefore work over `ssh -t`, and piping works over plain `ssh`.

The host's own backup routine must exclude `/var/lib/gift-dispenser/`.
After the wipe the database holds no keys, and the admin may copy it by hand to keep the KPI data.

### 6.3 Telegram integration

- Long polling through `@grammyjs/runner`, processing one account's updates in order and different accounts in parallel.
- `allowed_updates` is `message`, `callback_query`, and `my_chat_member`.
- Messages and button taps are handled only from private chats.
  From groups, only changes to the bot's own status are handled (§6.4); the bot never posts in a group.
- 429 responses wait for Telegram's `retry_after` (grammY auto-retry).
- Each account may send 3 updates per 2 seconds; the bot drops the excess without replying.
- Admin messages are sent as plain text, so a group title cannot inject formatting.

### 6.4 Group setup

Telegram gives a bot a group's chat ID only when the bot is added to that group, and an invite link cannot be turned into an ID.
The bot therefore reports the ID to the admin instead of storing a list of groups.

On a `my_chat_member` update from a group:

| Change | Bot does |
|---|---|
| Made by `ADMIN_USER_ID`, and the bot is now a member or an admin | Messages the admin: "I'm now an admin in “<group title>” (ID -1001234567890). Use it as: dispenser event create --group=-1001234567890 …" or "I'm now a member of “<group title>” (ID …). Make me an admin so I can check membership." |
| The bot is added by anyone else | Leaves the group without a word, and logs the chat ID |
| Any change to the bot's status in the event's group, by anyone | Messages the admin with the new status; when the bot is no longer an admin: "The group check fails, and nobody can claim, until you make me an admin again." |

A change that matches more than one row sends one message, with the warning appended when it applies.

Setup steps:

1. Message the bot once from the admin account, so it may message the admin.
2. From the admin account, add the bot to the event group and promote it to admin with every right switched off.
   Telegram only guarantees membership lookups to bots that are admins.
3. Take the chat ID from the bot's "I'm now an admin" message.
   Promoting the bot can convert a basic group into a supergroup, which changes its ID; the message is sent after that change, so it carries the final ID.
4. Pass the ID as `event create --group=<id>`, which checks live that the bot is an admin there, shows the group title for confirmation, and saves it for the bot's replies.
   The `=` form is required because the ID starts with a minus sign.

## 7. Data model

SQLite, with `journal_mode=WAL`, `synchronous=FULL`, `secure_delete=ON`, `foreign_keys=ON`, and `busy_timeout=5000`.
All times are stored as UTC.
A database holds exactly one event.
The tables keep an `event_id` anyway, so supporting several events later is a migration, not a rewrite.

### `meta`

`schema_version`.
The bot and the CLI refuse a database whose version differs from the build's, so a database made by an older build is recreated with `init`, not opened.

### `events`

| Column | Meaning |
|---|---|
| `id` | |
| `title` | Shown to claimants |
| `tz` | IANA time zone for input and display |
| `opens_at`, `closes_at` | The window; `opens_at < closes_at` |
| `closed_at` | Set by an early close |
| `group_chat_id` | The event group |
| `group_title` | The group's name, read from Telegram by `event create` and `event edit --group`; shown to claimants |
| `passphrase_hash` | scrypt (N = 2^14, r = 8, p = 1) with a random salt, encoded with its parameters; null after the wipe |
| `max_attempts` | Default 5 |
| `instructions` | Operator-written Markdown (§8.6), sent with every code |
| `trip_count`, `trip_seconds` | Claim-burst limit; default 5 claims per 60 seconds |
| `paused_at`, `paused_reason` | Set by a breaker trip (`burst`) or a manual pause (`manual`) |
| `resumed_at` | Set by `resume`; the burst window never reaches back past it |
| `exported_at`, `wiped_at` | Lifecycle markers |

`CHECK (passphrase_hash IS NOT NULL OR wiped_at IS NOT NULL)`.

### `codes`

| Column | Meaning |
|---|---|
| `id`, `event_id` | |
| `private_key` | Canonical lowercase `0x` form; null after the wipe |
| `address` | Checksummed address derived from the key |
| `claimed_by`, `claimed_at` | The claim log; survives the wipe |
| `checkin_status` | Null, `sent`, `unreachable`, or `failed` |
| `checkin_sent_at` | |
| `checkin_answer` | `uploaded`, `not_yet`, `stuck_install`, `stuck_import`, `stuck_upload`, or `stuck_other` |
| `checkin_answered_at` | |

`UNIQUE (event_id, claimed_by)`.
`UNIQUE (event_id, address)`.

### `attempts`

`(event_id, telegram_user_id)` → `failures`, `locked_at`.

`locked_at` is set the first time `failures` reaches `max_attempts`, and is never cleared.
The lockout check uses `failures`, so `unlock` resets `failures` while `locked_at` keeps counting the account as once locked out (§10.1).

## 8. Claim flow

### 8.1 States of the event

```
create ─► scheduled ─(opens_at)─► open ─(closes_at or close)─► closed ─(export + wipe)─► wiped
```

State is derived from timestamps on every read, never stored as a status.
The event is **open** when `opens_at ≤ now < closes_at`, `closed_at` is null, and `wiped_at` is null.
An open event **accepts claims** when, in addition, `paused_at` is null.
A paused or closed event keeps re-sending codes already assigned until the wipe; it only stops assigning new ones.

### 8.2 Replies

`/start`:

- When the event is open: "To get your gift code for <title>, join <group title> on Telegram, then send me the passphrase you were given."
  It is sent as Telegram HTML, with `<title>` and `<group title>` HTML-escaped and in bold.
  An account that already has a code also gets: "You already have a code. Send /mycode to see it again."
- Otherwise: "No event is open right now."

`/mycode`:

- The account has a code and keys are not wiped: re-send it (§8.6).
- The account has a code and keys are wiped: "Codes are no longer stored. If you lost yours, ask the organizers."
- Otherwise: "You don't have a code yet."

Any other text message is handled in this order, and the first matching row answers:

| # | Condition | Reply | Uses a try |
|---|---|---|---|
| 1 | The account already has a code | Re-send it, or the "no longer stored" reply after the wipe | No |
| 2 | The event is not open | "No event is open right now." | No |
| 3 | The event is paused | "Claims are paused. Please check back soon." | No |
| 4 | The membership lookup fails | "Couldn't check the group right now. Please try again in a minute." | No |
| 5 | Not a member | "This is for members of <group title>. Join it, then send the passphrase again.", sent as HTML with the name escaped and in bold | No |
| 6 | Restricted in the group | "Finish the group's verification first, then send the passphrase again." | No |
| 7 | Locked out | "Too many wrong tries. Show this to the organizers: ID <telegram user id>" | No |
| 8 | No unclaimed codes left | "All codes have been claimed." | No |
| 9 | Wrong passphrase | "That's not it. <n> tries left.", or the locked-out reply when this was the last try | Yes |
| 10 | Right passphrase | `claimOrGet`, then send the code (§8.6) | No |

The group is checked before the passphrase on purpose.
A non-member's text is never compared with the passphrase and uses no try, so someone who found the passphrase online cannot even test it.

Other commands and non-text messages get the `/start` reply.

### 8.3 Input rules

- Identity comes only from the update's `from.id`.
- Callback data must match `ci:<answer>` exactly, with `<answer>` one of the six check-in answers (§7).
  Anything else gets an empty `answerCallbackQuery` and nothing more.
- Passphrases are normalized before hashing, both when set and when checked: Unicode NFKC, trimmed, internal whitespace collapsed to one space, lowercased.
  Comparison is constant-time against the scrypt hash.
- Text longer than 200 characters counts as a wrong try without being hashed.
- A try is reserved, in one transaction, before the passphrase is hashed, and given back when it was right.
  At most `max_attempts` sends from one account are therefore checked at once; further concurrent sends get the locked-out reply until those finish.
- Claimant text is only ever normalized and hashed for the comparison.
  It is never stored, echoed, or logged.

### 8.4 Membership

The bot calls `getChatMember(group_chat_id, from.id)` on every attempt that reaches row 4.
The result is never stored or cached.

- `creator`, `administrator`, and `member` pass.
- `restricted` is refused, even when Telegram reports `is_member = true`.
  Rose's captcha mutes new members until they solve it, so an unverified account is `restricted`.
- `left` and `kicked` are not members.
- An error, including the bot having been removed or demoted, fails closed (row 4).

Membership is checked only before a claim.
A claimant who leaves the group afterwards keeps the code, and `/mycode` keeps working.

### 8.5 `claimOrGet`

One `BEGIN IMMEDIATE` transaction:

1. If the account already has a code, return it.
2. Re-check that the event is open and accepting claims.
3. Count claims with `claimed_at` within the last `trip_seconds`, and not before `resumed_at`.
   If the count has already reached `trip_count`, set `paused_at = now` and `paused_reason = burst`, and return "paused" (§9).
4. Assign the unclaimed code with the lowest `id` to the account.

It returns at most one key with its address, or "pool empty", "paused", or "closed".
The `UNIQUE (event_id, claimed_by)` constraint backs it up.

The transaction commits before the message is sent.
`synchronous=FULL` makes the commit survive a power cut, so a code that was sent can never be rolled back and issued again.

### 8.6 Delivery

The message uses Telegram HTML, every inserted value is HTML-escaped, and it is sent with link previews off, so it ends with the instructions rather than a preview card:

```
Your gift code for <b><title></b>:
<tg-spoiler>0x…key…</tg-spoiler>

<instructions>

<a href="https://gnosisscan.io/address/0x…address…">See this code's balance</a>
Save your code somewhere safe now: the bot deletes all codes shortly after the event.
Lost this message? Send /mycode to see it again.
```

Under the message, one inline button, "📋 Copy gift code", is a `copy_text` button holding the key, so tapping it copies the key without revealing it.
The key itself is a spoiler only, not monospace, because Telegram drops a spoiler around monospace text (§15).

The address appears only inside the balance link at the end, because claimants who saw it as text took it for something they had to enter.
`gnosis.blockscout.com` now redirects to `gnosisscan.io`, so the link goes there directly.

The instructions file is Markdown, converted to Telegram HTML by the bot, because Telegram's own MarkdownV2 is not ordinary Markdown and rejects a whole message over one unescaped `.` or `-`:

| Markdown | Telegram shows |
|---|---|
| `# Heading` to `###### Heading` | A bold line; Telegram has no headings |
| `**bold**` | Bold |
| `_italic_` or `*italic*` | Italic, opened only at the start of a word, so `snake_case` and `2 * 3` stay text |
| `` `code` `` | Monospace, its content shown as written |
| `[text](https://…)` | A link; its text may be bold or italic |
| `- item`, `* item` or `+ item` | `• item`, keeping the indent |
| `\*` and other backslash-escaped punctuation | The character itself |

Everything else, numbered lists and bare URLs included, is shown as written, and Telegram makes bare URLs clickable.
The converter writes only tags it also closes and escapes all other text, so a typo such as an unclosed `**` shows as text and cannot make a delivery fail.

`event create` and `event edit` refuse a `[text](url)` link whose URL does not start with `http://` or `https://`, naming its line.
They also refuse instructions that would push the message over Telegram's 4,096-character limit, counted as Telegram shows the text, without the markup.

### 8.7 Failure handling

Every failure fails closed: no code is sent, and the claimant gets a generic message.

| Failure | Claimant sees | Also |
|---|---|---|
| Membership lookup error | Row 4 of §8.2 | Logged |
| Any unexpected error in the claim path | "Something went wrong. Please try again later." | Logged, without the update's contents |
| Send fails | Nothing new | The assignment stands, so the next message or `/mycode` re-sends the same code |
| The account blocked the bot | Nothing | No retry |

## 9. Circuit breaker

Passphrases are handed out one person at a time, so honest claims arrive slowly and steadily.
A burst is therefore abnormal, and the breaker can be tight without turning honest people away.

| Rule | Default |
|---|---|
| Up to `trip_count` claims may succeed within `trip_seconds`; the next one trips the breaker and is refused | 5 claims per 60 seconds, set with `--trip-rate <n>/<seconds>` |

A trip sets `paused_at` and `paused_reason`, and sends the admin one message:

```
🔴 <title>: claims paused
Claim burst: a 6th claim within 60 s (limit 5 per 60 s).
Codes already claimed can still be re-sent.
Check:  dispenser status
Resume: dispenser resume
```

- While paused, new claims get "Claims are paused. Please check back soon."; re-sends keep working, because they reveal nothing new.
- `dispenser pause` pauses by hand.
- `dispenser resume` shows the reason, asks for confirmation (or takes `--yes`), clears `paused_at`, and sets `resumed_at`.
  The burst window then restarts empty, so the claims that caused the trip cannot trip it again.
- If strangers were in the burst, rotate the passphrase with `dispenser event passphrase` before resuming.

## 10. Metrics

The KPI funnel maps onto three sources:

| Stage | Source | Definition |
|---|---|---|
| Handed out | Bot | Codes claimed |
| Redeemed | Chain | First transaction sent from the code's address after `claimed_at`, within 30 days |
| Bought storage | Chain | First transaction from the code's address to the PostageStamp contract after `claimed_at`, within 30 days |
| First upload | Check-in | The claimant answers "Yes" |

No metrics output ever lists individual accounts or addresses.

### 10.1 Bot numbers

These come from tables the claim flow needs anyway, so the metrics add no tracking:

| Number | Query |
|---|---|
| Tried the passphrase | Accounts in `attempts`, plus accounts that claimed; `attempts` only records failures |
| Claimed | Codes with `claimed_by` set |
| Locked out | `attempts` rows with `locked_at` set |

Non-members and people turned away by a pause or an empty pool leave no record.

### 10.2 On-chain activity

`dispenser stats` fetches each claimed address's outgoing transactions from Gnosis Chain's Blockscout API when it runs.
It sends at most 5 requests per second and waits on 429 responses.

- Only transactions sent *from* the address count; the incoming funding transaction does not.
- Only transactions after `claimed_at` and within 30 days of it count, so running `stats` on day 45 still gives the 30-day figure.
- "Bought storage" means a transaction to the PostageStamp contract (`0x45a1502382541Cd610CC9068e88727426b696293`).
  Buying a postage batch is required before any upload.

Known blind spot: someone who moves the funds to their own Bee wallet and buys storage from there counts as redeemed, but not as having bought storage.
The check-in covers that case.

Uploads cannot be seen on-chain.
Chunks are stamped off-chain, and nothing public ties a chunk to a batch.

### 10.3 Check-in

`dispenser checkin send` sends one message to each claimant whose `checkin_status` is null:

```
Hi! 7 days ago you got a Swarm gift code at <title>.
Did you upload your first file?

[ Yes ]                    [ Not yet ]
[ Stuck installing Bee ]   [ Stuck importing the key ]
[ Stuck uploading ]        [ Stuck on something else ]
```

- The day count is the whole days since that account's `claimed_at`, at least 1, with "1 day ago" for one day.
- It requires the event to be closed.
  The admin runs it around day 7.
- `checkin_status = sent` and `checkin_sent_at` are written before sending, so a second run never sends twice.
- A 403 from Telegram (the account blocked the bot) sets `unreachable`, and a 400 sets `failed`.
  Both are about that one recipient, so the run goes on.
- Any other send error (another Telegram error code, or no answer from Telegram) sets that code `failed`, is logged, and stops the run.
  Such an error (a revoked token, a long rate limit, an outage) would hit every remaining claimant too.
  The rest stay pending, and the command exits with code 1 and says to run it again after fixing the cause.
- Every send error is logged with the code's ID and Telegram's error code, never a message text.
- The command prints the counts of sent, unreachable, and failed messages, also when it stopped early.

A tap:

- counts only when `from.id` has a claimed code with a non-null `checkin_status`, and only until 30 days after its `claimed_at`;
- stores the answer and `checkin_answered_at`, replacing any earlier answer;
- shows the pop-up "Thanks! You can tap again to change your answer.";
- after day 30 shows "This check-in has closed." and is not stored;
- from anyone else, or with malformed data, gets an empty `answerCallbackQuery`.

Taps never trigger anything else, and no free text is collected.
The bot must keep running until 30 days after the last claim to receive taps.

### 10.4 Reading metrics

`dispenser stats` prints totals, with percentages of codes claimed:

```
<title>                                       window: 30 days (final)
──────────────────────────────────────────────────────────────────────
Bot       tried passphrase 61 · claimed 58 · locked out 1
Chain     redeemed 35 (60%) · bought storage 27 (47%)
Check-in  sent 58 · unreachable 2 · failed 0 · answered 30
          uploaded 19 · not yet 6 · stuck 5 (installing 3 · key 1 · uploading 1 · other 0)
```

Until 30 days have passed since the last claim, the header reads `window: 30 days (in progress, final on <date>)`.

## 11. CLI and event lifecycle

### 11.1 Commands

```
dispenser init                          create the database; refuses if it exists
dispenser status                        event state, claims, breaker, group, lockouts, recent claims

dispenser event create --title <text> --group=<chat id>
    --opens "YYYY-MM-DD HH:mm" --closes "YYYY-MM-DD HH:mm" [--tz <IANA zone>]
    --instructions <file> [--passphrase-generate]
    [--max-attempts <n>] [--trip-rate <n>/<seconds>]
dispenser event edit <any create flag except the passphrase>
dispenser event passphrase [--generate]
dispenser event close

dispenser import <file|-> [--yes]
dispenser pause
dispenser resume [--yes]
dispenser unlock <telegram user id>
dispenser export
dispenser wipe --checksum <sum>

dispenser checkin send
dispenser stats
```

`status` looks like this:

```
Event     Swarm booth · OPEN · closes 2026-11-14 18:00 CET
Claims    42 claimed · 18 left · last claim 14:31:38
Breaker   PAUSED since 14:31:43 · claim burst: a 6th claim within 60 s (limit 5 per 60 s)
Group     -1001234567890 “Swarm booth chat” · bot is an admin (checked live)
Lockouts  1 · 482130001
Recent    14:31:05  482130001  0x3fA1…92c0
          14:31:09  987654321  0x77b2…1d4e
```

`status` is the one place that shows individual claims, because judging a breaker trip needs them.
`Recent` lists the last 10 claims.

### 11.2 Rules

- The bot refuses to start without a database, so a mis-mounted volume fails loudly instead of starting an empty event that could re-issue claimed keys.
- `event create` refuses when an event already exists.
- `--tz` defaults to `TZ`.
- The passphrase is read from a hidden prompt, which refuses to run without a terminal.
  `--passphrase-generate` (or `event passphrase --generate`) instead picks 3 words from the EFF short word list (about 31 bits) and prints them once.
  The prompt refuses a passphrase of more than 200 characters or one starting with "/", because the bot counts longer text as a wrong try and reads text starting with "/" as a command.
- `--group` is confirmed live against Telegram: the bot must be an admin in that chat.
  The group's name is saved with it, so after renaming the group, `event edit --group=<same id>` makes the bot show the new name.
- `event edit` takes any create flag except the passphrase until the event closes.
  `--opens` can change only before the event opens, and `--closes` must stay in the future.
  A closed event never reopens.
- `event passphrase` replaces the passphrase immediately; failure counts are kept.
- `--trip-rate` takes `<n>/<seconds>` with `n ≥ 1` and seconds from 10 to 3600.
- `pause` works on an unwiped event that is not paused; `resume` works only on a paused one.
- `unlock` resets one account's `failures`.
  The locked-out reply shows the claimant their own ID, so no usernames are stored.

### 11.3 Import

`import` is a dry run unless `--yes` is given.
Both report the number of keys parsed, and any errors by line number, never by content.

- Keys may be separated by newlines, commas, tabs, or spaces; the dapp's bare-key export has one per line.
- Keys must be valid secp256k1 private keys as ethers v6 parses them, with or without `0x`.
  They are stored in canonical lowercase `0x` form, with their checksummed address.
- If the first line is the dapp's table header (`privateKey address batchId`), the error says to export bare keys instead.

The import aborts, and imports nothing, on:

- an invalid key;
- a duplicate within the input;
- a key already in the database;
- a closed or wiped event.

Importing more codes while the event is open is allowed.

### 11.4 Export and wipe

- `export` requires a closed, unwiped event.
  It writes the unclaimed keys to stdout, one per line, ready to paste into Recover Funds, and sets `exported_at`.
- `export` writes to stderr: `checksum: <16 hex> (<n> codes)`.
  The checksum is the first 16 hex characters of the SHA-256 of the sorted unclaimed addresses, newline-joined.
- `wipe` requires a completed export (`exported_at` set) and a matching checksum, so it can only run with an export's output in hand.
  A closed event never takes new claims, so the unclaimed set cannot change after the export.
- `wipe` sets every `private_key` to null, claimed or not, and nulls `passphrase_hash`.
  It then sets `wiped_at`, and runs `VACUUM` and `wal_checkpoint(TRUNCATE)`.
- The claim log and check-in columns stay, so `/mycode` replies "no longer stored", and `checkin send` and `stats` keep working.

### 11.5 Runbook

| When | Steps |
|---|---|
| Before | Write `bot.env`; `dispenser init`; `docker compose up -d`. Group setup (§6.4). `ssh -t pi dispenser event create …`. Shortly before the event, `ssh pi 'dispenser import - --yes' < "gift codes.txt"`. `dispenser status` |
| During | `dispenser status`. On a breaker trip, check `status`, then `resume` or stay paused, rotating the passphrase if strangers were in the burst. `unlock <id>` for a claimant who shows a lockout. |
| After | Claims close at `--closes`, or earlier with `event close`. `ssh pi dispenser export > unclaimed.txt`. Sweep the unclaimed funds with Recover Funds. Delete `unclaimed.txt`. `dispenser wipe --checksum <sum>` |
| Around day 7 | `dispenser checkin send` |
| Day 30 and after | `dispenser stats`; then the bot can be stopped, and the database, which holds no keys, can be archived |

Keys pass through SSH stdin and stdout, so no key file is ever written on the Pi.

## 12. Secrets handling

### 12.1 Keys

- Keys are stored in plain text in `dispenser.db`, in a directory only the container user can read.
- In the bot process a key exists only as the one result of `claimOrGet` and inside the message that sends it; it is never cached.
- Only the CLI reads many keys at once (`export`), enforced by the lint rule in §6.1.
- The export file on the admin's laptop holds the unclaimed keys until the sweep, and is deleted after it.

### 12.2 Passphrase

- Only the scrypt hash is stored, and it is nulled by the wipe.
- The passphrase is never printed, except once by `--generate`.

### 12.3 Logs

- Log lines carry the Telegram user ID and code addresses.
- They never carry a key, a passphrase attempt, the bot token, or the text of an incoming message.
- The error handler logs an update's ID and type, never its contents.
- The logger also scrubs the bot token by value.

### 12.4 Supply chain

- Runtime dependencies are grammY and its runner and auto-retry plugins, better-sqlite3, ethers, and a logger, pinned by the lockfile.
- scrypt and SHA-256 come from Node's built-in `crypto`.
- The image contains no secrets.

## 13. Reliability

- `synchronous=FULL` and commit-before-send keep a sent code from ever being issued again (§8.5).
- A crash between commit and send leaves an assigned but unsent code, which the next message or `/mycode` delivers.
- There is no journal and no backup.
  If the database is lost mid-event, the claim log is lost with it.
  The same keys must then never be imported again, because some were already handed out.
  The event continues with freshly generated codes in a new database, and the KPI for the earlier claims is lost.
- `restart: unless-stopped`, with Docker enabled at boot.
- An unhandled error exits the process.
- If polling has not succeeded for 3 minutes, the process exits.
- On `SIGTERM`, the bot stops polling, waits up to 10 seconds for in-flight updates, and closes the database.
- Migrations are numbered SQL files.
  The bot and the CLI both refuse a schema version they don't expect.

## 14. Testing

Vitest, with tests beside the code as `*.test.ts`, written test-first in vertical slices.
Each test is watched failing before code is written to pass it, and the full suite runs green after each slice.
No test uses a funded key; fixtures are random keys.

### 14.1 Seams

Tests drive the code only through these three agreed entry points:

| Seam | Entry point | Faked boundaries | Real |
|---|---|---|---|
| Bot | `handleUpdate(update)` on a bot built over a temp data directory | Telegram transport, clock | Core, SQLite |
| CLI | `runCli(argv, stdin)` → stdout, stderr, exit code | Telegram, Blockscout, clock, randomness | Everything else |
| Import parser | `parseCodes(text)` → keys with addresses, or line errors | none | all |

- "Restart" in a test means building a new bot over the same data directory.
- The Telegram fake intercepts grammY's outgoing calls at the transport.
  Tests check what users would see (which code, which message), not call sequences.
  Fake updates and `getChatMember` results are complete, real-shaped payloads built from grammY's types.
- The Blockscout fake serves complete, real-shaped responses captured from the live API.
- Expected values come from outside the code under test.
  Examples: the well-known Hardhat account #0 key mapped to `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, literal checksums, and a frozen copy of a real dapp export.

### 14.2 Guarantees

| Guarantee | Seam and scenario | Break it catches |
|---|---|---|
| One code per account | Bot: 50 concurrent correct passphrases from one member → every reply carries the same code, and the next account gets a different one | The has-a-code check outside the transaction |
| Never twice | Bot: 30 members against 20 codes, with the burst limit raised → 20 distinct codes and 10 "all claimed" replies | Assignment not excluding claimed codes |
| Members only | Bot: `left`, `kicked`, and `restricted` (with `is_member = true`) → refused, and no try used; `creator`, `administrator`, and `member` → proceed | Accepting restricted members; counting a non-member's text as a try |
| Fails closed | Bot: `getChatMember` errors → no code sent, and no try used | An error path falling through to the send |
| Brute force capped | Bot: 5 wrong tries → locked, and the reply shows the ID; still locked after a restart; CLI `unlock` → the account can try again, and `stats` still counts the lockout | An in-memory counter; off-by-one; `unlock` clearing `locked_at` |
| Burst trip | Bot: 5 claims within 60 seconds succeed; the 6th is refused as paused, and the admin gets one message; the first 5 still get re-sends | Trip counted after assigning; off-by-one; a pause that blocks re-sends |
| Resume restarts the window | CLI `resume` → the next claim succeeds although 5 claims sit inside the last 60 seconds | The window ignoring `resumed_at` |
| Event window | Bot: before `opens_at`, after `closes_at`, and after `event close` → no claims; re-sends still work after close | A missing state check; a close that blocks re-sends |
| Re-send | Bot: the send fails → the next message delivers the same code; `/mycode` delivers the same code | Rolling back or reassigning on send failure |
| No way to the list | Bot: malformed callback data, check-in taps from non-claimants, and updates from groups → never more than the caller's own code, and no reply in groups | Handlers trusting button data, or replying in groups |
| Group setup | Bot: added by the admin → the admin gets the ID; added by anyone else → the bot leaves without a word; CLI: `event create` refuses a group where the bot isn't an admin | Leaving on the admin's own add; trusting a group without a live check |
| No secrets in logs | Bot and CLI: success and error paths with captured logs → no key, passphrase, or token appears | Logging an update or an error's context |
| Export, then wipe | CLI: `export` before close → refused; `wipe` with a wrong checksum → refused, nothing deleted; after `wipe` the database file bytes contain no key, the claim log is intact, and `/mycode` replies "no longer stored" | `secure_delete` off; write-ahead log not truncated; wipe dropping the claim log |
| Import | Parser: Hardhat #0 → its literal address; the frozen dapp export → its literal addresses; an invalid key, a duplicate, or the table header → line errors without content; CLI: a dry run writes nothing; a key already in the database aborts the import | Parser regressions; partial imports |
| Check-in once | CLI: `checkin send` twice → each claimant gets one message; a 403 → `unreachable` | Status written after the send |
| Check-in taps | Bot: a claimant's tap is stored, and a later tap replaces it; a tap after day 30 → "closed", not stored | The window off by one; answers stored for the wrong account |
| Stats | CLI with the Blockscout fake: transactions before the claim, after day 30, or incoming → not counted; a transaction to PostageStamp → bought storage; the output contains no address or account ID | Counting incoming or out-of-window transactions |

Before a test file is called done, a mutation check runs: change a constant, flip a branch, or drop a side effect, and confirm that some test fails.

### 14.3 Acceptance

Before the event, a documented dry run uses a second bot from BotFather, a throwaway group running Rose with a captcha, and unfunded keys, plus one key funded with a little xDAI so `stats` can count a redemption.
It walks the full lifecycle: group setup, create, import, a claim, a non-member and an unverified (restricted) member refused, lockout and unlock, a burst trip and resume, close, export, sweep, wipe, check-in and a tap, and `stats`.

## 15. To verify during planning

Each item has a fallback, so none blocks the design.

| Assumption | Fallback if it does not hold |
|---|---|
| Telegram renders `<code>` nested inside `<tg-spoiler>` | Did not hold (test run, 2026-10-23): the key showed as monospace with no spoiler, as the Bot API says spoiler "can contain and can be part of any other entities, except pre and code". The key is now `<tg-spoiler>` only, with a `copy_text` button that copies it (§8.6) |
| A member who passed Rose's captcha has status `member` | Also accept `restricted` when both `is_member` and `can_send_messages` are true |
| Promoting the bot in a basic group sends a `my_chat_member` update from the new supergroup | The bot also reports the new ID from the `migrate_to_chat_id` service message |
| `0x45a1502382541Cd610CC9068e88727426b696293` is the current PostageStamp contract on Gnosis | Verified 2026-10-20: Blockscout labels it "PostageStamp v2.1", and it receives `createBatch` calls daily |
| Blockscout's Gnosis API serves an address's outgoing transactions within its rate limits | Verified 2026-10-20: `/api/v2/addresses/<address>/transactions?filter=from` returns 50 per page with `next_page_params`, and allows 180 requests per window. Otherwise use RPC only: `eth_getTransactionCount` gives "redeemed" at the time `stats` runs, without the 30-day window or "bought storage", and the report says so |

## 16. Future to-dos

Roughly in order of value.
Section references point to the full design in commit `6211710`.

1. More admin alerts: codes running low or empty, errors, restarts, the group check failing; plus an external heartbeat (§10).
2. Encryption at rest, with crypto-shredding as the reliable wipe on an SSD (§13).
3. A secret-free journal and restore, including re-sending codes claimed before a restore (§14).
4. A leak detector: count non-members who send the correct passphrase, which shows that it is circulating online.
5. Choosing the checks per event: group only, or passphrase only.
6. Several events at once, an event picker, and online events.
7. Gift drives, the dapp's table and JSON formats, and non-key secrets (§12.3).
8. KPI extras: an automatic check-in on day N, CSV output, a "moved out" category, turned-away counts, and the chequebook rule (§9).
9. Integrity trips, a headcount trip, claw-back export, pre-flight checks, and message templates (§8.5, §11).
10. Reusing unclaimed codes at a later event.
