# Discord Music Bot

Bot Discord de musique, modération et sécurité, exécuté en continu sur Replit.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — lancer le bot et son endpoint de santé
- `pnpm --filter @workspace/api-server run build` — vérifier la préparation du paquet de production
- `pnpm --filter @workspace/api-server run start` — lancer le bot en production
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Secret obligatoire : `DISCORD_TOKEN`
- Secrets optionnels : `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `LAVALINK_PASSWORD`
- Variables optionnelles : `CLIENT_ID`, `GUILD_ID`, `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_SECURE`, `MUSIC_ENABLED`, `MUSIC_SEARCH_ENGINE`, `BOT_OWNER_IDS`, `DATA_DIR`, `FFMPEG_PATH`

## Stack

- pnpm workspace, Node.js 24, CommonJS
- Discord.js 14
- Kazagumo + Shoukaku pour Lavalink
- `@napi-rs/canvas` pour les cartes graphiques
- Stockage local dans `data/`

## Where things live

- `artifacts/api-server/index.js` — point d'entrée du bot et endpoint de santé
- `artifacts/api-server/commands/` — commandes slash musique
- `artifacts/api-server/utils/` — commandes, panneaux, sécurité, persistance et musique
- `artifacts/api-server/deploy-commands.js` — publication des commandes slash
- `artifacts/api-server/lavalink/` — configuration d'un nœud Lavalink privé

## Architecture decisions

- Le service HTTP ne sert que les contrôles de santé Replit ; les fonctions utilisateur passent par Discord.
- Le déploiement doit utiliser une VM toujours active, pas l'autoscaling, car la connexion Gateway Discord doit rester ouverte.
- Sans variables `LAVALINK_*`, le bot utilise les nœuds publics de secours définis dans le code.

## Product

Lecture musicale, commandes de modération, protection anti-abus, panneaux interactifs, salons vocaux temporaires, tickets, giveaways et outils communautaires.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Activer les intents privilégiés `Server Members`, `Presence` et `Message Content` dans le portail développeur Discord.
- Publier avec le type **VM / Always Running**.
- Les données stockées dans `data/` doivent être sauvegardées avant une reconstruction complète du déploiement.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
