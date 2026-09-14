---
name: DigitalOcean continuous deployment
description: How production updates are delivered to the always-running Discord bot.
---

Production uses a root-owned systemd timer on the DigitalOcean VPS to check the GitHub `main` branch every 60 seconds. When the commit changes, it resets to the remote version, installs locked dependencies, and restarts the PM2 process.

**Why:** Replit publishing requires a manual republish, and GitHub OAuth did not permit creating workflow files. VPS-side polling provides the requested zero-click deployment without storing an SSH key in GitHub.

**How to apply:** Push tested changes to GitHub `main`. Expect production to update within about one minute. Keep the bot under the PM2 name `discord-music-bot` and preserve its VPS-local environment file.