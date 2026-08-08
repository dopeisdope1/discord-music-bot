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
- ✅ SERVER MEMBERS INTENT — nécessaire pour `!join`/`/join` (lit la présence des membres)
- ✅ PRESENCE INTENT — nécessaire pour `!join`/`/join` (détecte l'activité "écoute Spotify")
- ✅ MESSAGE CONTENT INTENT — nécessaire pour les commandes textuelles (`!play`, `-clear`...)

Permissions à cocher lors de l'invitation du bot (OAuth2 URL Generator) :
- `bot`, `applications.commands`
- Connect, Speak, Send Messages, Embed Links, Use Slash Commands, Manage Roles,
  Manage Channels, Manage Messages (pour les commandes de modération)

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
| `/join`       | Rejoint et joue ce que tu écoutes actuellement sur Spotify |
| `/pause`      | Met en pause                                  |
| `/resume`     | Reprend la lecture                            |
| `/skip`       | Passe au titre suivant                        |
| `/stop`       | Arrête et vide la file d'attente              |
| `/queue`      | Affiche la file d'attente                     |
| `/volume`     | Change le volume (0-150)                      |
| `/loop`       | Change le mode de répétition                  |
| `/modconfig`  | (admin) Configure les rôles de modération via un menu déroulant |

Le panel **"En cours de lecture"** (Components V2) apparaît automatiquement à chaque
nouveau morceau, avec des boutons interactifs : ⏸️/▶️ ⏭️ ⏹️ 🔁 📜.

## 6bis. Commandes textuelles (sans slash)

En plus des commandes slash, le bot répond aussi aux préfixes classiques :

- **`!`** : préfixe principal, pour toutes les commandes musique
  (`!play`, `!join`, `!skip`, `!stop`, `!pause`, `!resume`, `!queue`, `!volume 80`, `!loop queue`, `!help`)
- **`-`** : préfixe réservé aux commandes de modération (rôle configuré via
  `/modconfig`, ou administrateur du serveur)
  - `-clear <nombre>` / `-clear @membre` → supprime des messages
  - `-snipe` → affiche le dernier message supprimé du salon
  - `-renew` → recrée le salon à l'identique (vide)
  - `-hide` / `-unhide` → cache/affiche le salon pour @everyone
  - `-lock` / `-unlock` → empêche/autorise @everyone à écrire dans le salon
  - `-help` → affiche le panel d'aide modération

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

## 7bis. `!join` / `/join` — écouter le Spotify de quelqu'un

`!join` regarde ton activité Discord "écoute Spotify" (visible sur ton profil quand
tu as connecté ton compte Spotify dans Discord > Paramètres > Connexions) et fait
jouer le même titre au bot. Si tu n'écoutes rien sur Spotify, il te le dit.

Le message de confirmation inclut un bouton **"Écouter avec lui"** : n'importe qui
peut cliquer dessus pour que le bot rejoigne SON salon vocal et joue ce que la
personne suivie écoute au moment du clic (pas une capture figée du morceau initial).

Nécessite les intents **SERVER MEMBERS** et **PRESENCE** activés (voir section 3) —
sans ça, `member.presence` est toujours vide côté Discord.js et `!join` répondra
systématiquement "n'écoute rien sur Spotify", même si c'est faux.

## 8. Notes sur Components V2

Components V2 nécessite `discord.js` en version **14.16+**. C'est un nouveau système
de mise en page (Container, TextDisplay, Separator...) activé via le flag
`MessageFlags.IsComponentsV2`, utilisé ici dans `utils/nowPlayingPanel.js`. Si tu as
une ancienne version de discord.js installée, fais `npm update discord.js`.
