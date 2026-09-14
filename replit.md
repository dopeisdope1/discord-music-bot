# Discord Moderation Bot

Bot Discord de modération, sécurité et gestion de serveur, exécuté en continu.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — lancer le bot et son endpoint de santé
- `pnpm --filter @workspace/api-server run build` — vérifier la préparation du paquet de production
- `pnpm --filter @workspace/api-server run start` — lancer le bot en production
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Secret obligatoire : `DISCORD_TOKEN`
- Variables optionnelles : `CLIENT_ID`, `GUILD_ID`, `BOT_OWNER_IDS`, `DATA_DIR`

## Stack

- pnpm workspace, Node.js 24, CommonJS
- Discord.js 14
- `@napi-rs/canvas` pour les cartes graphiques
- Stockage local dans `data/`

## Where things live

- `artifacts/api-server/index.js` — point d'entrée du bot et endpoint de santé
- `artifacts/api-server/commands/` — commandes slash (à nettoyer avec `deploy-commands.js`)
- `artifacts/api-server/utils/` — commandes, panneaux, sécurité et persistance
- `artifacts/api-server/deploy-commands.js` — retrait des anciennes commandes slash

## Architecture decisions

- Le service HTTP ne sert que les contrôles de santé ; les fonctions utilisateur passent par Discord.
- Le déploiement de production utilise une VM toujours active, pas l'autoscaling, car la connexion Gateway Discord doit rester ouverte.
- Le déploiement principal est conservé sur une VM DigitalOcean.

## Product

Commandes de modération, protection anti-abus, panneaux interactifs, gestion
des salons vocaux ordinaires, tickets, sauvegardes, giveaways et outils
communautaires.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Activer les intents privilégiés `Server Members` et `Message Content` dans le portail développeur Discord.
- Publier avec le type **VM / Always Running**.
- Les données stockées dans `data/` doivent être sauvegardées avant une reconstruction complète du déploiement.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details