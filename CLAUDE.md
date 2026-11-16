# Notes pour Claude (à lire en début de session)

## Déploiement : déjà automatique, ne pas le redemander

- La production tourne sur un **VPS DigitalOcean** sous **pm2**. Elle se met à jour toute seule : le VPS vérifie la branche `main` toutes les minutes, récupère le code, redémarre le bot (`artifacts/api-server/scripts/autodeploy.sh`, détails dans `.agents/memory/digitalocean-continuous-deployment.md`).
- Ça vaut pour **tous les bots** de ce dépôt : rien à redéployer à la main.
- **Replit n'est pas utilisé pour la production** : ne jamais proposer « Pull sur Replit », « republier » ni « redémarrer sur Replit ».
- Ne pas demander à l'utilisateur où le bot est hébergé ni comment le mettre à jour : c'est ici, c'est automatique.

## Workflow attendu

1. Faire la modification et lancer les tests concernés (`pnpm install` d'abord si `node_modules` est absent).
2. Commit et push sur la branche de la session.
3. PR vers `main`, puis fusion : c'est la fusion dans `main` qui déclenche la mise en ligne (environ 1 minute).
4. Dire simplement que le changement sera en ligne d'ici ~1 minute. Si l'utilisateur dit qu'il ne voit pas le changement, vérifier le déploiement VPS (`pm2 ls`, `/var/log/autodeploy-bot.log`) plutôt que de redemander la config.

## Repères

- Le préfixe de gestion est réglable : en production c'est `,` (défaut dans le code : `&`). Le panel s'ouvre avec `,panel`.
- Le bot en ligne s'appelle **pfp** (pfp#4513).
- Piste connue si un déploiement ne prend pas : `autodeploy.sh` redémarre l'app pm2 `discord-bot` par défaut, alors que la note de déploiement parle de `discord-music-bot`. Un nom qui ne correspond pas fait échouer `pm2 restart` après le `git reset`, et le script ne réessaie plus.
