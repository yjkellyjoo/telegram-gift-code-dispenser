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
