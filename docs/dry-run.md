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
