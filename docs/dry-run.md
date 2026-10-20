# Dry run before the event

Run this once, a few days before the event, on the Pi.
Do the README's "Install on the Pi" steps first, except `bot.env` and the first start: this checklist covers them.
It uses a second bot from BotFather, a throwaway group, and unfunded keys, plus one key funded with a little xDAI so `stats` can count a redemption.
Tick each line; stop and fix anything that does not behave as written.

## Accounts

You need three Telegram accounts.

- **A** is your admin account, the one whose numeric ID is `ADMIN_USER_ID`.
- **B** and **C** are two more accounts, each on a phone or desktop client you can use at the same time.

Keys are handed out lowest ID first, so the first account to claim gets the first key imported.
B claims first on purpose: B gets the funded key, and B is the claimant `stats` will count.

## Setup

During the dry run the real paths are used, and `/etc/gift-dispenser/bot.env` holds the TEST bot's token.
The last section puts the real token back.

- [ ] Create a test bot with BotFather.
- [ ] Write its token as `BOT_TOKEN` in `/etc/gift-dispenser/bot.env`, with your own `ADMIN_USER_ID` and `TZ` (the README shows the file).
- [ ] Create a throwaway group, add Rose, and turn its captcha on.
- [ ] `dispenser init` prints `created /data/dispenser.db`.
      The CLI output must appear on your screen: the `dispenser` wrapper runs the `cli` service, which has Docker logging switched off.
- [ ] `docker compose -f /opt/gift-dispenser/compose.yaml up -d`, then `docker compose -f /opt/gift-dispenser/compose.yaml logs -f bot` shows `bot started`.
- [ ] From A, message the test bot.
- [ ] Add the bot to the group from A and promote it with every right off: the bot messages A "I'm now an admin in …" with the chat ID.
- [ ] If the group became a supergroup, the ID in that message starts with `-100`; use that one (spec §15).
- [ ] Copy an `instructions.txt` into the current directory, then run `dispenser event create --title "Dry run" --group=<id> --opens "<a few minutes ago>" --closes "<this evening>" --instructions instructions.txt --passphrase-generate`, with the window open now, and note the passphrase it prints.
- [ ] Put the funded key alone in `funded.txt` and import it first: `dispenser import funded.txt --yes`.
- [ ] Make 12 unfunded keys and import them second: `for i in $(seq 12); do echo "0x$(openssl rand -hex 32)"; done > unfunded.txt`, then `dispenser import unfunded.txt --yes`.
- [ ] `dispenser status` shows `Claims    0 claimed · 13 left`.
- [ ] Only A, B and C claim during this run, so 10 unclaimed keys remain for the export step.

## Claims

- [ ] B is not in the group yet: B sends the passphrase and gets "This is for members of …".
- [ ] B joins the group but does not solve Rose's captcha: the passphrase gets "Finish the group's verification first, …".
      This confirms that an unverified member shows as `restricted` (spec §15).
- [ ] B solves the captcha and sends the passphrase again: B gets a code, hidden as a spoiler, with the key in monospace inside it (spec §15).
      This is the first claim, so it is the funded key.
- [ ] B sends `/mycode`: the same code comes back.
- [ ] C joins the group and solves the captcha.
- [ ] C sends 5 wrong passphrases, a second or two apart: the reply to the 5th shows C's ID, and `dispenser status` shows it on the `Lockouts` line.
- [ ] `dispenser unlock <C's id>` lets C try again.

## Breaker

Do this at least a minute after B's claim, so that claim is outside the burst window.

- [ ] `dispenser event edit --trip-rate 1/60`, so two claims within a minute trip the breaker.
- [ ] Within one minute, C sends the right passphrase and gets a code, then A sends it: A gets "Claims are paused", and the bot sends A the 🔴 message "claims paused" (a 2nd claim within 60 s).
- [ ] `dispenser status` shows the breaker `PAUSED`, the claims, the group check and the lockouts.
- [ ] Restore the defaults: `dispenser event edit --trip-rate 5/60`, then `dispenser resume --yes`.
- [ ] A sends the passphrase again and gets a code.
- [ ] `dispenser status` shows `Claims    3 claimed · 10 left`.

## After

- [ ] `dispenser event close` prints `closed: 3 claimed, 10 unclaimed`.
- [ ] `dispenser export > unclaimed.txt` shows the checksum line on your screen, and `unclaimed.txt` holds only the 10 unclaimed keys, one per line, with no checksum line in it.
- [ ] Paste them into the dapp's Recover Funds tab: it accepts them.
- [ ] Delete `unclaimed.txt`, then `dispenser wipe --checksum <sum>` prints `wiped 13 keys; the claim log is kept`.
- [ ] B sends `/mycode`: it now says codes are no longer stored.
- [ ] `dispenser checkin send` prints `sent 3 · unreachable 0 · failed 0`; tap an answer in the check-in message on each account.
- [ ] `dispenser stats` shows `redeemed 0`.
      Blockscout answers an address with no transactions with an empty list (verified 2026-10-20), so the unfunded accounts count as zero rather than failing.
- [ ] With B's funded key (it is still in B's chat), send one transaction in a wallet on Gnosis Chain, then `dispenser stats` shows `redeemed 1 (33%)`.
- [ ] Delete `funded.txt` and `unfunded.txt`.

## Ending the dry run

Do this before the real event, so no test data and no test token remain.

- [ ] `docker compose -f /opt/gift-dispenser/compose.yaml down`
- [ ] `sudo rm /var/lib/gift-dispenser/dispenser.db*`
      This removes only the database files, so the directory keeps its `10001` owner and `0700` mode.
- [ ] Put the REAL bot token in `/etc/gift-dispenser/bot.env`: `chmod 0600` it, replace `BOT_TOKEN`, then `chmod 0400` it again.
- [ ] `dispenser init`
- [ ] `docker compose -f /opt/gift-dispenser/compose.yaml up -d --force-recreate`, so the bot reads the new token.
- [ ] `docker compose -f /opt/gift-dispenser/compose.yaml logs bot` shows `bot started` with the real bot's username.
