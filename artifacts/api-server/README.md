# Discord moderation and security bot

This service is a long-running Discord bot for server administration,
moderation, anti-abuse protection, confessions, tickets, giveaways, polls,
backups, and ordinary voice moderation/logging.

## Requirements

- Node.js 18+ (Node.js 20 or newer is recommended)
- A Discord application with a bot token
- Message Content, Server Members, and (when presence-based moderation is
  enabled) Presence intents enabled in the Discord developer portal
- `pnpm` from the repository root

## Configuration

Create an environment file outside version control with at least:

```dotenv
DISCORD_TOKEN=your_token
CLIENT_ID=your_application_id
DATA_DIR=/var/lib/discord-bot/data
BOT_OWNER_IDS=your_discord_id
```

`GUILD_ID` is optional. `DATA_DIR` defaults to `data/` in this package and
contains server configuration, moderation history, logs, and backups. Never
commit the environment file or its values.

## Run locally

From the repository root:

```bash
pnpm --filter @workspace/api-server run dev
```

The service also exposes a small health endpoint for the hosting platform:
`/api/healthz` and `/healthz`.

## Discord application commands

The bot uses text commands and interactive Discord panels. Any old
application commands from earlier versions must be removed explicitly:

```bash
pnpm --filter @workspace/api-server run deploy
pnpm --filter @workspace/api-server run deploy -- --global
```

The first command clears guild-scoped registrations visible to the bot. The
second clears the global registration set. Run both when retiring an older
installation that used both scopes.

## DigitalOcean deployment

The production bot runs on an always-on DigitalOcean droplet under `pm2`.
`scripts/autodeploy.sh` can be installed as a cron task on that droplet:

```bash
bash scripts/autodeploy.sh --install
```

On each check it fetches `main`, updates only when the revision changed,
reinstalls production dependencies when `package.json` changed, restarts the
pm2 application, and rolls back if the process does not return online.
The script never edits `.env` or `data/`.

The repository also keeps the GitHub-to-VPS deployment workflow. Configure its
DigitalOcean/VPS SSH secrets in the repository settings; do not place those
values in source files.

## Preserved bot features

- Server administration, role/channel management, and permission panels
- Moderation, sanctions, anti-spam, anti-link, anti-scam, anti-nuke, and logs
- Anonymous confessions, tickets, polls, giveaways, verification, and
  autoroles
- Ordinary voice moderation (mute, move, deafen, voice access) and voice logs
- Server structure backups and restoration

The service does not create temporary channels or provide audio playback.

## Checks

Useful checks from this package include:

```bash
node --check index.js
node scripts/test-command-routing.js
```

Additional focused tests live under `scripts/`. They use temporary data
directories and do not modify production server state.