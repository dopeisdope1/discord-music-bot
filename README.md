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
  Audit Log (pour attribuer les changements de rôle manuels dans "Logs rôles")

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
    profil), `.snipe` (dernier message supprimé du salon)
  - Réservées aux administrateurs : `.clear`, `.renew`, `.hide`, `.unhide`,
    `.lock`, `.unlock`, `.massrole`, `.panel`
  - Admin, ou permission Discord **Bannir des membres** : `.ban`, `.unban`
  - `.help` → affiche les commandes disponibles pour toi (liste complète si tu
    es administrateur)

Les deux préfixes ci-dessus (`!` et `.`) sont configurables par serveur via le
panel `.panel` (réservé aux administrateurs) : deux boutons ouvrent chacun une
fenêtre pour saisir un nouveau préfixe, sans avoir à toucher au code. La valeur
est sauvegardée dans `data/` (voir `DATA_DIR` juste en dessous).

### Rendre `data/` permanent sur Railway (préfixes + salons de logs)

Par défaut, `data/` vit sur le disque du container Railway, qui est
**réinitialisé à chaque redéploiement** (donc à chaque push sur `main`,
vu l'auto-déploiement) : les préfixes et salons de logs configurés via
`.panel` reviendraient sinon à leurs valeurs par défaut à chaque mise à jour
du bot. Pour que ça ne bouge plus jamais :

1. Sur le dashboard Railway, ouvre le service du bot → onglet **Volumes** →
   **Add Volume**.
2. Choisis un point de montage, par exemple `/app/data`.
3. Ajoute une variable d'environnement `DATA_DIR` avec la même valeur
   (`/app/data`) dans l'onglet **Variables**.
4. Redéploie une dernière fois (ou attends le prochain push) : à partir de
   là, `data/prefixes.json` et `data/logChannels.json` vivent sur le volume,
   qui n'est jamais effacé par un redéploiement.

Sans cette étape (qui se fait uniquement sur le dashboard Railway, pas dans
le code), le préfixe musique par défaut du code est `?` et le préfixe
membres/modération `.` — donc un redéploiement sans volume revient à ces
valeurs-là plutôt qu'à `!`/`.`.

Le même panel `.panel` propose aussi une section **Logs** : un menu déroulant
par catégorie (**Logs modération** = `.clear`/`.ban`/`.unban`, **Logs salon** =
`.renew`/`.hide`/`.unhide`/`.lock`/`.unlock`, **Logs rôles** = `.massrole` ET
tout ajout/retrait de rôle fait à la main sur le profil d'un membre) où tu
choisis, en tapant pour rechercher, le salon où le bot doit poster un message.
Laisser une catégorie vide désactive simplement ses logs. Pour "Logs rôles",
un changement fait via `.massrole`/le panel donne un seul message résumé
(nombre de membres touchés) ; un changement fait à la main donne un message
par membre avec le nom de la personne qui a fait le changement (nécessite la
permission **View Audit Log**, voir section 3).

Le bouton **"Gérer les rôles en masse"** du panel `.panel` fait la même chose
que `.massrole add|remove @role` (ajouter/retirer un rôle à tous les membres
non-bot du serveur), mais via deux menus déroulants de rôles au lieu de taper
la commande.

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
**Bannir des membres**). `.ban` ouvre le panel **Zinki Assassini** (menu
déroulant natif Discord pour choisir qui bannir) ; `.unban` ouvre un panel
listant les membres actuellement bannis, ou débannit directement si tu lui
donnes un ID (`.unban <id>`).

Nécessite les intents **SERVER MEMBERS** et **PRESENCE** activés (voir section 3) —
sans ça, `member.presence` est toujours vide côté Discord.js et `!join` répondra
systématiquement "n'écoute rien sur Spotify", même si c'est faux.

## 8. Notes sur Components V2

Components V2 nécessite `discord.js` en version **14.16+**. C'est un nouveau système
de mise en page (Container, TextDisplay, Separator...) activé via le flag
`MessageFlags.IsComponentsV2`, utilisé ici dans `utils/nowPlayingPanel.js`. Si tu as
une ancienne version de discord.js installée, fais `npm update discord.js`.
