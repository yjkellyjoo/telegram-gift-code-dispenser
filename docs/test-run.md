# Test run before the event

Run this once, a few days before the event, on the Pi.
It uses the event's real bot and real Telegram group, while the group is not yet shared publicly.
It uses test keys: 12 unfunded keys, plus one key funded with a little xDAI so `stats` can count a redemption.
At the end the database is deleted, so the real event starts clean; the bot, its token and its place in the group stay as they are.
Tick each line; stop and fix anything that does not behave as written.

## Accounts

You need three Telegram accounts.

- **A** is your admin account, the one whose numeric ID is `ADMIN_USER_ID`.
- **B** and **C** are two more accounts, each on a phone or desktop client you can use at the same time.
  Neither may be in the group yet: the test checks what happens when they join.

Keys are handed out lowest ID first, so the first account to claim gets the first key imported.
B claims first on purpose: B gets the funded key, and B is the claimant `stats` will count.

## Setup

- [ ] Do the README's "Install on the Pi" steps, with the real bot's token in `/etc/gift-dispenser/bot.env`.
      `dispenser init` prints `created /data/dispenser.db`.
      The CLI output must appear on your screen: the `dispenser` wrapper runs the `cli` service, which has Docker logging switched off.
- [ ] `docker compose -f /opt/gift-dispenser/compose.yaml logs -f bot` shows `bot started`.
- [ ] From A, send `/start` to the bot: it replies "No event is open right now.".
      This also lets the bot message A, which it needs for admin messages.
- [ ] In the event's group, Rose is an admin and its captcha is on (`/captcha on`).
- [ ] Add the bot to the group from A and promote it with every right off: the bot messages A "I'm now an admin in …" with the chat ID.
- [ ] If the group became a supergroup, the ID in that message starts with `-100`; use that one (spec §15).
      Keep this ID: the real event uses it too.
- [ ] Put the event's `instructions.md` in the current directory, then run `dispenser event create --title "Test run" --group=<id> --opens "YYYY-MM-DD HH:mm" --closes "YYYY-MM-DD HH:mm" --instructions instructions.md`, for example `--opens "2026-10-22 14:30" --closes "2026-10-22 21:00"`.
      Write each time as `YYYY-MM-DD HH:mm`, in quotes: a 24-hour clock, leading zeros (`09:05`, `2026-10-02`), one space between date and time, no seconds and no time zone.
      Times are read in the `TZ` from `bot.env`; `--tz <zone>` overrides it for this event.
      Pick an opening time already past and a closing time later than the test will take; the After section closes the event early.
      It prints `open from … to …`: check the window includes now.
      It asks for the passphrase twice, so run it on the Pi or over `ssh -t`.
      Type a test passphrase, not the event's: B and C will learn it.
      To have the CLI pick three random words instead, add `--passphrase-generate`; it prints them once.
- [ ] Put the funded key alone in `funded.txt` and import it first: `dispenser import funded.txt --yes`.
- [ ] Make 12 unfunded keys and import them second: `for i in $(seq 12); do echo "0x$(openssl rand -hex 32)"; done > unfunded.txt`, then `dispenser import unfunded.txt --yes`.
- [ ] `dispenser status` shows `Claims    0 claimed · 13 left`.
- [ ] Only A, B and C claim during this run, so 10 unclaimed keys remain for the export step.

## Claims

- [ ] B is not in the group yet: B sends the passphrase and gets "This is for members of …".
- [ ] B joins the group but does not solve Rose's captcha: the passphrase gets "Finish the group's verification first, …".
      This confirms that an unverified member shows as `restricted` (spec §15).
- [ ] B solves the captcha and sends the passphrase again: B gets a code, hidden as a spoiler until tapped, with a "📋 Copy gift code" button under the message (spec §8.6).
      Tapping the button copies the key without revealing it: paste it somewhere private to check.
      Below it, the instructions show their bold lines, bullets and links, and no link preview card ends the message.
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

## Ending the test run

Do this before the real event, so no test keys, claims or passphrase remain.
The bot, its token and its admin rights in the group stay.

- [ ] Remove B and C from the group, so they cannot claim a real code at the event.
- [ ] `docker compose -f /opt/gift-dispenser/compose.yaml down`
- [ ] `sudo sh -c 'rm /var/lib/gift-dispenser/dispenser.db*'`
      The `sh -c` makes root expand the `*`: your own shell cannot read that directory, so a plain `sudo rm …*` finds nothing.
      This removes only the database files, so the directory keeps its `10001` owner and `0700` mode.
- [ ] `dispenser init` prints `created /data/dispenser.db`.
- [ ] `docker compose -f /opt/gift-dispenser/compose.yaml up -d`, then `docker compose -f /opt/gift-dispenser/compose.yaml logs bot` shows `bot started`.

The real event then follows the README's "Running an event" table, with the group ID kept above.
