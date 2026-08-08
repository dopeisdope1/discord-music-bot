# 🎵 Bot Discord Musique (YouTube + Spotify) — Panel Components V2

## 1. Prérequis
- Node.js **18+** (idéalement 20+)
- Un bot Discord créé sur https://discord.com/developers/applications
- Des identifiants API Spotify sur https://developer.spotify.com/dashboard
  (uniquement `Client ID` et `Client Secret`, pas besoin d'OAuth utilisateur)

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
```

## 3. Intents & permissions à activer

Sur le portail développeur Discord, dans l'onglet **Bot** :
- ✅ SERVER MEMBERS INTENT (optionnel)
- ✅ MESSAGE CONTENT INTENT

Permissions à cocher lors de l'invitation du bot (OAuth2 URL Generator) :
- `bot`, `applications.commands`
- Connect, Speak, Send Messages, Embed Links, Use Slash Commands

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
| `/play`       | Joue une musique (recherche, lien YouTube ou Spotify) |
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

- **`m!`** : préfixe principal, pour toutes les commandes
  (`m!play`, `m!skip`, `m!stop`, `m!pause`, `m!resume`, `m!queue`, `m!volume 80`, `m!loop queue`)
- **`-`** : préfixe réservé **uniquement** à deux commandes spéciales
  - `-clear` → vide la file d'attente en gardant le titre en cours de lecture
  - `-renew` → supprime l'ancien panel "En cours de lecture" et en renvoie un tout neuf
    (utile si le panel a été noyé sous d'autres messages)

Ces commandes texte nécessitent que l'intent **MESSAGE CONTENT** soit bien activé sur
le portail développeur (voir section 3).

## 7. Notes sur le support Spotify

DisTube ne joue pas l'audio Spotify directement (DRM) : le plugin `@distube/spotify`
récupère les métadonnées (titre, artiste, playlist/album) puis DisTube recherche et
joue l'équivalent sur YouTube automatiquement. C'est totalement transparent pour
l'utilisateur : il colle un lien Spotify dans `/play`, ça fonctionne.

## 8. Notes sur Components V2

Components V2 nécessite `discord.js` en version **14.16+**. C'est un nouveau système
de mise en page (Container, TextDisplay, Separator...) activé via le flag
`MessageFlags.IsComponentsV2`, utilisé ici dans `utils/nowPlayingPanel.js`. Si tu as
une ancienne version de discord.js installée, fais `npm update discord.js`.
