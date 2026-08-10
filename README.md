# 🎵 Bot Discord Musique (YouTube + Spotify via Lavalink) — Panel Components V2

## 1. Prérequis
- Node.js **18+** (idéalement 20+)
- Un bot Discord créé sur https://discord.com/developers/applications
- Des identifiants API Spotify sur https://developer.spotify.com/dashboard
  (uniquement `Client ID` et `Client Secret`, pas besoin d'OAuth utilisateur —
  utilisés pour la recherche de titres, pas pour la lecture)
- Un nœud **Lavalink** (voir section 2bis)

## 2. Installation

```bash
npm install
cp .env.example .env
```

Remplis le fichier `.env` :
```
DISCORD_TOKEN=ton_token
CLIENT_ID=id_de_ton_application
GUILD_ID=id_de_ton_serveur   # optionnel, pour un déploiement instantané en dev
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
LAVALINK_HOST=...
LAVALINK_PORT=...
LAVALINK_PASSWORD=...
LAVALINK_SECURE=true
GIPHY_API_KEY=...   # optionnel — clé publique de démo utilisée sinon (`.gif`)
DATA_DIR=...         # optionnel — voir "Rendre data/ permanent sur Railway" plus bas
```

## 2bis. Nœud Lavalink

La lecture audio passe par un serveur **Lavalink** (le bot ne fait que lui parler en
WebSocket/HTTP — c'est le nœud Lavalink qui gère la connexion UDP vers Discord).
C'est nécessaire sur des hébergeurs comme Railway qui bloquent l'UDP sortant pour
les services applicatifs classiques.

- **Nœud public gratuit (par défaut)** : le bot utilise un nœud public si aucune
  variable `LAVALINK_*` n'est définie. Pratique, mais **pas garanti dans le temps**
  (les nœuds publics tombent ou changent sans préavis). Liste de nœuds à jour :
  https://lavalink.darrennathanael.com/ ou https://freelavalink.serenetia.com/list
  Si le bot n'arrive plus à jouer de musique, c'est probablement le nœud par défaut
  qui est tombé : prends-en un autre dans la liste et mets à jour `LAVALINK_HOST`,
  `LAVALINK_PORT`, `LAVALINK_PASSWORD`, `LAVALINK_SECURE` sur Railway.
- **Nœud auto-hébergé (plus fiable)** : héberge ton propre serveur Lavalink sur un
  petit VPS (voir https://lavalink.dev/getting-started/) et pointe les variables
  `LAVALINK_*` dessus.

## 3. Intents & permissions à activer

Sur le portail développeur Discord, dans l'onglet **Bot** :
- ✅ SERVER MEMBERS INTENT — nécessaire pour `!join` (lit la présence des membres)
- ✅ PRESENCE INTENT — nécessaire pour `!join` (détecte l'activité "écoute Spotify")
- ✅ MESSAGE CONTENT INTENT — nécessaire pour les commandes textuelles (`!play`, `.clear`...)

Permissions à cocher lors de l'invitation du bot (OAuth2 URL Generator) :
- `bot`, `applications.commands`
- Connect, Speak, Send Messages, Embed Links, Use Slash Commands, Manage Roles,
  Manage Channels, Manage Messages (pour les commandes de modération), View
  Audit Log (pour attribuer les changements de rôle manuels dans "Logs rôles"),
  Manage Expressions (pour `.create`)

## 4. Déployer les commandes slash

```bash
npm run deploy
```

## 5. Lancer le bot

```bash
npm start
```

## 6. Commandes disponibles

| Commande      | Description                                   |
|---------------|------------------------------------------------|
| `/play`       | Joue une musique (nom/artiste, ou lien YouTube/Spotify) |
| `/pause`      | Met en pause                                  |
| `/resume`     | Reprend la lecture                            |
| `/skip`       | Passe au titre suivant                        |
| `/stop`       | Arrête et vide la file d'attente              |
| `/queue`      | Affiche la file d'attente                     |
| `/volume`     | Change le volume (0-150)                      |
| `/loop`       | Change le mode de répétition                  |

Le panel **"En cours de lecture"** (Components V2) apparaît automatiquement à chaque
nouveau morceau, avec des boutons interactifs : ⏸️/▶️ ⏭️ ⏹️ 🔁 📜.

## 6bis. Commandes textuelles (sans slash)

En plus des commandes slash, le bot répond aussi aux préfixes classiques :

- **`!`** : préfixe principal, pour toutes les commandes musique
  (`!play`, `!join`, `!skip`, `!stop`, `!pause`, `!resume`, `!queue`, `!volume 80`, `!loop queue`, `!help`)
- **`.`** : préfixe pour les commandes membres et de modération
  - Ouvertes à tout le monde par défaut : `.pic [@membre]` / `.avatar` (photo de
    profil), `.snipe` (dernier message supprimé du salon), `.gif <recherche>`
    (envoie un gif aléatoire via Giphy)
  - Admin, ou rôle autorisé pour une catégorie de permission qui inclut la
    commande (voir "Page Permissions" ci-dessous) : `.clear`, `.renew`,
    `.hide`, `.unhide`, `.lock`, `.unlock`, `.massrole`, `.addrole`,
    `.delrole`, `.panel`, `.create <nom> <url>` (crée un emoji), `.helpall`
    (liste les commandes par catégorie), `.perms` (liste les rôles par
    catégorie)
  - Admin, permission Discord **Bannir des membres**, ou rôle autorisé (même
    système) : `.ban`, `.unban`, `.unbanall` (débannit tout le monde, avec
    confirmation)
  - **Admin uniquement**, jamais assignable à une catégorie de permission
    (trop destructeur pour être délégué) : `.banall` (bannit tous les
    membres humains du serveur sauf toi, avec confirmation — action
    irréversible)
  - `.help` → panel interactif : un écran d'accueil résume chaque catégorie
    (noms des commandes), un menu déroulant permet ensuite de naviguer dedans
    pour voir le détail sans tout afficher d'un coup. La liste "Commandes
    autorisées" est calculée **commande par commande** pour toi précisément
    (pas par groupe fixe) : si tu n'as accès qu'à `.helpall`/`.perms` via une
    catégorie de `.panel` > Permissions, c'est tout ce qui s'affiche — pas le
    reste de la modération

`.panel` (réservé aux administrateurs, ou aux membres avec un rôle autorisé —
voir "Page Permissions" ci-dessous) ouvre un panel à **quatre pages**
navigables via les boutons du bas : **Préfixes**, **Logs**, **Permissions** et
**Rôles**.

**Page Préfixes** — les deux préfixes ci-dessus (`!` et `.`) sont configurables
par serveur : deux boutons ouvrent chacun une fenêtre pour saisir un nouveau
préfixe, sans avoir à toucher au code.

### Pourquoi la config ne se réinitialise plus après un redéploiement

Le disque du container Railway est **réinitialisé à chaque redéploiement**
(donc à chaque push sur `main`, vu l'auto-déploiement) : tout ce qui n'est
écrit que dans `data/` y disparaîtrait à chaque mise à jour du bot.

Pour éviter ça sans configuration manuelle sur Railway, chaque changement fait
via `.panel` (préfixe, salon de logs ou rôle autorisé) est aussi sauvegardé
dans un salon Discord caché appelé **`zinki-config`** (créé automatiquement, masqué à
@everyone) — voir `utils/configChannel.js`. Au démarrage du bot, la config y
est relue et rechargée en mémoire **avant** de toucher au disque local :
Discord, contrairement au container Railway, n'est jamais réinitialisé, donc
rien de ce qui est déjà configuré n'est jamais perdu ni remis à zéro.
**Ne supprime pas le salon `zinki-config`** — c'est là que tout est stocké.

`data/` (et la variable d'env `DATA_DIR`, pour la pointer vers un Volume
Railway si tu en montes un) reste utilisé comme cache local rapide en plus de
ça, mais n'est plus la seule copie de la config.

**Page Logs** — un menu déroulant par catégorie (**Logs modération** =
`.clear`/`.ban`/`.unban`, **Logs salon** = `.renew`/`.hide`/`.unhide`/
`.lock`/`.unlock`, **Logs rôles** = `.massrole` ET tout ajout/retrait de rôle
fait à la main sur le profil d'un membre, **Logs sécurité** = alertes
anti-nuke, voir section 7quater) où tu choisis, en tapant pour rechercher, le
salon où le bot doit poster un message. Laisser une catégorie vide désactive
simplement ses logs. Pour "Logs rôles", un changement fait via
`.massrole`/le panel donne un seul message résumé (nombre de membres
touchés) ; un changement fait à la main donne un message par membre avec le
nom de la personne qui a fait le changement (nécessite la permission
**View Audit Log**, voir section 3).

**Page Permissions** (modifiable uniquement par de vrais administrateurs,
même si un rôle autorisé permet d'ouvrir `.panel` — pour éviter qu'un rôle
autorisé s'auto-accorde plus de droits) — un système de **catégories
numérotées et indépendantes** ("Permission 1", "Permission 2"... chacune sa
propre liste de commandes et de rôles, sans héritage automatique entre
elles, contrairement à l'exemple à deux groupes fixes "mod"/"ban" d'avant) :

- Bouton "➕ Créer une catégorie" → crée une "Permission N" vide (N ne se
  réutilise jamais, même après suppression d'une catégorie).
- Menu déroulant "Gérer une catégorie" → ouvre le détail d'une catégorie
  existante, avec un menu multi-sélection listant toutes les commandes
  assignables (coche celles que tu veux inclure) et un menu de rôles
  (`RoleSelectMenu`, choisis qui a accès), plus un bouton pour la supprimer.

Les commandes assignables : `.helpall`, `.perms`, `.panel`, `.renew`,
`.hide`, `.unhide`, `.lock`, `.unlock`, `.massrole`, `.addrole`, `.delrole`,
`.create`, `.ban`, `.unban`, `.unbanall`, `.clear` (`.banall` en est
volontairement exclue).
Ça s'ajoute aux permissions Discord natives (Administrateur toujours, plus
Bannir des membres pour `.ban`/`.unban`/`.unbanall` spécifiquement), qui
continuent de fonctionner normalement — les catégories ne font qu'ajouter
des accès, jamais en retirer. `.helpall` liste les catégories avec leurs
commandes (équivalent texte de cette page) ; `.perms` liste les catégories
avec leurs rôles. Persisté dans `data/permissionCategories.json` (+ salon
`zinki-config`, voir plus bas), comme les préfixes et les logs.

Le bouton **"Gérer les rôles en masse"** sur la page Permissions fait la même
chose que `.massrole add|remove @role` (ajouter/retirer un rôle à tous les
membres non-bot du serveur), mais via deux menus déroulants de rôles au lieu
de taper la commande.

**Page Rôles** — un bouton "➕ Créer un rôle" ouvre une fenêtre pour saisir un
nom (texte libre, obligatoirement une modale — aucun menu déroulant ne permet
de taper du texte), puis un menu déroulant "Choisir une couleur" propose une
liste de couleurs prédéfinies (ou "Par défaut", ou "Annuler la création") ; un
menu déroulant natif Discord "🗑️ Choisir un rôle à supprimer" liste les rôles
du serveur — en sélectionner un affiche une confirmation (nom du rôle +
nombre de membres concernés) avant suppression réelle, puisque l'action est
irréversible ; un troisième menu "↕️ Choisir un rôle à réorganiser" affiche
sa position actuelle (ex: "3 / 12") avec des boutons ⬆️ Monter / ⬇️ Descendre
pour le déplacer d'un cran à la fois, et un bouton "🎯 Aller à un rang précis"
qui ouvre une fenêtre pour taper directement le rang voulu (Discord ne
propose aucun composant "glisser-déposer" côté API bot — impossible de
réordonner à la souris comme dans les paramètres natifs du serveur, ce
bouton est l'équivalent le plus proche : un saut direct plutôt qu'un
cran à la fois). Le rôle @everyone et les rôles gérés par une intégration
(bot, boost serveur...) ne peuvent être ni supprimés ni déplacés depuis ce
panel ; un rôle ne peut pas non plus être monté au-dessus du rôle le plus
haut du bot (limite de hiérarchie Discord). Pour attribuer/retirer un rôle à
un membre précis (plutôt qu'à tout le monde ou dans la hiérarchie), voir
`.addrole`/`.delrole` ci-dessous.

**`.addrole` / `.delrole`** — commandes autonomes (pas dans `.panel`) pour
ajouter/retirer un rôle à un seul membre, à trois niveaux :
- Sans argument (`.addrole`) : panel "Ajout de rôle" avec un menu déroulant
  natif Discord pour choisir le membre, puis un second menu pour choisir le
  rôle.
- Avec juste le membre (`.addrole @membre` ou `.addrole <id>`) : saute
  directement à l'écran "Ajout de rôle" avec un champ **Cible** affichant le
  membre déjà choisi, et un menu déroulant pour choisir le rôle.
- Avec les deux (`.addrole @membre @role`, mentions ou ID) : appliqué tout de
  suite, sans aucun panel.

Contrairement à "Gérer les rôles en masse" (page Permissions), ça ne touche
qu'un seul membre. Mêmes restrictions que `.massrole` (rôle @everyone,
rôles gérés par une intégration, et hiérarchie du bot).

**Raccourci sans préfixe** : réponds au message de quelqu'un (ou mentionne-le)
en tapant `add <nom du rôle>` ou `del <nom du rôle>` (ex: quelqu'un demande
"ajoute-moi la perm image", tu réponds à son message par `add image`) — ça
ajoute/retire directement le rôle dont le nom correspond exactement (pas
sensible à la casse). Nécessite la même permission que `.addrole`/`.delrole` ;
si la cible, le nom de rôle ou la permission ne collent pas, rien ne se passe
(pour ne pas réagir à une phrase normale commençant par "add"/"del" par
hasard).

Ces commandes texte nécessitent que l'intent **MESSAGE CONTENT** soit bien activé sur
le portail développeur (voir section 3).

## 7. Notes sur le support Spotify

`!play <nom>` cherche directement sur Spotify (API officielle, via
`SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET`) :
- Un nom d'artiste exact (ex. `!play pnl`) affiche ses titres dans un menu déroulant.
- Une recherche de titre ambiguë affiche aussi un menu déroulant.
- Une recherche qui ne renvoie qu'un seul résultat net lance la lecture directement.

Une fois un titre choisi, le bot le recherche sur YouTube via Lavalink pour la
lecture réelle (Spotify ne fournit pas l'audio brut, et les nœuds Lavalink publics
n'ont pas toujours le plugin nécessaire pour lire les liens Spotify directement).

### Qui peut contrôler la musique ("DJ")

La première personne qui fait démarrer la musique sur un serveur (`!play`,
`!join`, ou le bouton "Écouter avec lui") devient la seule autorisée à
utiliser `pause`/`resume`/`skip`/`stop`/`leave`/`volume`/`loop` (texte, slash,
ou boutons du panel) tant que le player existe. Si quelqu'un d'autre essaie,
le bot envoie automatiquement un message à cette personne : "**{pseudo}** veut
gérer le bot avec toi, accepter ?" avec des boutons Accepter/Refuser ; si elle
accepte, la personne qui a demandé peut ensuite utiliser ces commandes elle
aussi, jusqu'à ce que la musique soit arrêtée (`stop`/`leave`/déconnexion
automatique), après quoi la prochaine personne à relancer la musique redevient
la seule autorisée. Ajouter des titres à la file (`play` sur un player déjà en
cours) reste ouvert à tout le monde.

## 7bis. `!join [@membre]` — écouter le Spotify de quelqu'un en direct

Commande textuelle uniquement (pas de `/join`).

`!join` (tout court) regarde TON activité Discord "écoute Spotify" (visible sur ton
profil quand tu as connecté ton compte Spotify dans Discord > Paramètres >
Connexions) et fait jouer le même titre au bot, à la même position (secondes
comprises). `!join @membre` fait pareil mais suit **quelqu'un d'autre**. Si la
personne visée n'écoute rien sur Spotify, le bot le dit clairement.

Une fois lancé, la lecture **suit automatiquement** la personne suivie : dès qu'elle
change de morceau sur Spotify, le bot bascule instantanément dessus (même position),
sans qu'il faille retaper la commande. Ça dure jusqu'à `!stop`/`/stop` ou jusqu'à ce
que tout le monde quitte le salon vocal.

Le message de confirmation inclut aussi un bouton **"Écouter avec lui"** : n'importe
qui peut cliquer dessus pour que le bot rejoigne SON salon vocal et se mette à suivre
la même personne (en lisant sa présence Spotify au moment du clic, pas une valeur figée).

## 7ter. `.ban` / `.unban` — modération

Réservés aux administrateurs (ou aux membres avec la permission Discord
**Bannir des membres**). Deux façons d'y accéder :

- `.ban` (texte) — panel **Zinki Assassini** avec un bouton
  "🔍 Chercher un membre" qui ouvre une fenêtre modale (champ texte) : rien ne
  s'affiche tant que tu n'as pas tapé et validé une recherche parmi les
  membres du serveur, seuls les résultats correspondants apparaissent
  ensuite dans un menu déroulant. Contrairement à un menu déroulant natif
  Discord cliqué directement (qui affiche toujours une liste par défaut,
  comportement du client impossible à désactiver via l'API), ce bouton +
  modale ne montre jamais rien avant une recherche explicite — au prix d'un
  clic en plus et d'un filtrage "après validation" plutôt que lettre par
  lettre en direct.
- `.unban` (texte, sans argument) — panel **Zinki Assassini** avec un menu
  déroulant natif Discord affiché directement (liste des membres
  actuellement bannis, généralement courte), chaque entrée précisant qui a
  fait le bannissement (lu depuis les logs d'audit Discord — nécessite la
  permission **View Audit Log**, voir section 3 ; absent si le ban est trop
  ancien pour figurer encore dans les logs) ; taper un pseudo filtre la
  liste en direct, mais Discord affiche quand même une liste par défaut
  avant de taper quoi que ce soit — comportement du client, pas du bot,
  impossible à masquer via l'API.
- `/ban` / `/unban` (slash) — même résultat, mais avec une **vraie recherche
  en direct** : le champ est vide tant que tu n'as rien tapé, et affiche des
  suggestions filtrées au fur et à mesure, sans validation nécessaire
  (autocomplétion Discord, backée par l'API de recherche de membres pour
  `/ban` et par la liste des bannis pour `/unban`).

`.unban` débannit aussi directement si tu lui donnes un ID (`.unban <id>`).

**`/ban` et `/unban` sont de nouvelles commandes slash : lance `npm run
deploy` une fois (avec `.env` rempli) pour qu'elles apparaissent sur
Discord — un simple `git push`/redéploiement Railway ne suffit pas, il faut
explicitement redéployer les commandes slash auprès de l'API Discord.**

Nécessite les intents **SERVER MEMBERS** et **PRESENCE** activés (voir section 3) —
sans ça, `member.presence` est toujours vide côté Discord.js et `!join` répondra
systématiquement "n'écoute rien sur Spotify", même si c'est faux.

## 7quater. Anti-nuke ("antifast")

Protection automatique contre les nukes (destruction rapide du serveur),
activée en permanence, aucune commande ni réglage — voir `utils/antiNuke.js`.
Détecte les rafales d'actions destructrices faites **à la main via Discord**
(pas par le bot lui-même, voir plus bas) par le même membre en moins de 10
secondes :

- Suppression ou création de **3 rôles**
- Suppression ou création de **3 salons**
- **3 bannissements** ou **3 expulsions**
- Création de **2 webhooks**
- Attribution de la permission **Administrateur** à un rôle (déclenché dès la
  1ère fois, pas besoin de répétition — c'est déjà un signal fort à lui seul)

Dès qu'un seuil est franchi, le responsable est neutralisé : **tous ses
rôles lui sont retirés** (hors @everyone et rôles gérés par une intégration).
C'est réversible (un admin peut les redonner ensuite), volontairement moins
radical qu'un kick/ban. Une alerte est envoyée dans "Logs sécurité" (voir
"Page Logs" ci-dessus) avec qui a été neutralisé et pourquoi.

Seul le **propriétaire du serveur** est exempté (ainsi que le bot lui-même) —
volontairement aucune liste d'admins de confiance en plus : un compte staff
compromis est justement le scénario que ça doit couvrir. Ça veut dire qu'un
admin qui crée légitimement plusieurs rôles/salons d'un coup en configurant
le serveur peut se faire neutraliser par erreur — c'est le compromis de tout
système anti-nuke (mêmes seuils que la plupart des bots équivalents).

**Les commandes du bot lui-même ne se déclenchent jamais entre elles** :
`.massrole`, `.banall`/`.unbanall`, la création/suppression de rôles via
`.panel`, etc. exécutent l'action avec le compte du bot, donc les logs
d'audit Discord attribuent l'action au bot — explicitement ignoré par
l'anti-nuke (`executor.bot`). Seules les actions faites directement par un
humain via l'interface Discord native (ou par un autre bot compromis) sont
concernées.

Nécessite la permission **View Audit Log** pour identifier qui a fait quoi
(voir section 3) — sans elle, l'anti-nuke ne peut rien détecter.

## 8. Notes sur Components V2

Components V2 nécessite `discord.js` en version **14.16+**. C'est un nouveau système
de mise en page (Container, TextDisplay, Separator...) activé via le flag
`MessageFlags.IsComponentsV2`, utilisé ici dans `utils/nowPlayingPanel.js`. Si tu as
une ancienne version de discord.js installée, fais `npm update discord.js`.
