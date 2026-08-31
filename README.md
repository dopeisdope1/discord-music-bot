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
DATA_DIR=...         # optionnel — voir "Persistance des données" en section 6ter
MUSIC_SEARCH_ENGINE=soundcloud  # optionnel — source de recherche (soundcloud par
                                # défaut : YouTube refuse les requêtes venant d'un
                                # hébergeur, "Sign in to confirm you're not a bot")
BOT_OWNER_IDS=...    # optionnel — statut prioritaire du bot (rang "owner"), voir section 6ter
```

## 2bis. Nœud Lavalink

La lecture audio passe par un serveur **Lavalink** (le bot ne fait que lui parler en
WebSocket/HTTP — c'est le nœud Lavalink qui gère la connexion UDP vers Discord).
C'est nécessaire sur des hébergeurs comme Railway qui bloquent l'UDP sortant pour
les services applicatifs classiques.

- **Nœud privé du projet (ce qu'on utilise)** : le dossier `lavalink/` est un
  service à part entière (`Dockerfile` + `application.yml`), déployé à côté du bot
  et joint par le réseau privé de l'hébergeur. C'est lui que décrivent les
  variables `LAVALINK_HOST` / `LAVALINK_PORT` / `LAVALINK_PASSWORD` /
  `LAVALINK_SECURE`. Les nœuds publics gratuits comptaient les connexions **par
  bot** et nous coupaient la musique au bout de quelques redéploiements.
- **Nœuds publics (repli automatique)** : si aucune variable `LAVALINK_*` n'est
  définie, le bot retombe sur une liste de nœuds publics. Pratique en dépannage,
  mais **pas garanti dans le temps** (ils tombent ou changent sans préavis).
  Listes à jour : https://lavalink.darrennathanael.com/ ou
  https://freelavalink.serenetia.com/list

### Mémoire du nœud (à ne pas retirer)

Le `Dockerfile` fixe `_JAVA_OPTIONS` (tas, métaspace et mémoire directe plafonnés,
GC série). Sans ces limites, la JVM se sert librement, l'hébergeur tue le conteneur
pour dépassement, et **le son s'arrête au bout d'une seconde** — sans la moindre
trace côté Java, puisque la JVM n'a pas le temps d'écrire quoi que ce soit. Le
symptôme visible dans les logs, ce sont deux démarrages de Lavalink à quelques
secondes d'intervalle alors qu'aucun déploiement n'a eu lieu.

Si le service gagne un jour en mémoire, ces valeurs se relèvent en définissant
`_JAVA_OPTIONS` dans les variables du service Lavalink : la variable de
l'hébergeur l'emporte sur celle de l'image, sans toucher au code.

### Pourquoi certains morceaux refusent de se lire

YouTube répond « Sign in to confirm you're not a bot » à toute requête venant
d'un hébergeur : le son ne peut donc venir que de **SoundCloud**. Conséquence
directe, **un titre absent de SoundCloud est injouable**, même s'il se trouve
sur Spotify ou YouTube — le bot retrouve son nom et sa pochette (métadonnées
Spotify), mais aucun flux audio derrière.

**Spotify n'a jamais fourni le son**, à aucun moment : il ne donne que le titre,
l'artiste et la pochette. Quand un morceau Spotify se jouait « avant », l'audio
venait en réalité de YouTube, en coulisses. C'est donc YouTube qui est tombé,
pas Spotify — et c'est pour ça que des favoris enregistrés depuis Spotify ne
se lancent plus.

Dans ce cas, le bot tente d'abord de relancer le morceau par une recherche
« titre + artiste » sur SoundCloud, puis explique clairement qu'il est
introuvable au lieu d'afficher le message anglais de Lavalink.

Pour savoir d'où le son peut encore venir à un instant donné, la commande
`&sources [titre ou lien]` (accès Sys) interroge le nœud source par source et
affiche la réponse exacte de chacune — elle distingue « ce morceau n'existe
nulle part » de « cette source nous refuse l'accès », ce que les messages
d'erreur habituels ne permettent pas de trancher.

Pour lever la limite, il faut donner un compte à YouTube (procédure ci-dessous).

### Rendre YouTube à nouveau lisible (une seule fois)

L'extension YouTube sait s'authentifier avec un compte Google. **Utilise un
compte jetable, jamais ton compte principal** : cet usage est contraire aux
conditions de YouTube et le compte peut être fermé.

1. Sur le service **Lavalink**, ajoute la variable `YOUTUBE_OAUTH=true`, puis
   redéploie.
2. Dans ses journaux, l'extension affiche un lien vers `google.com/device` et
   un code. Ouvre le lien, saisis le code, connecte-toi avec le compte jetable.
3. Les journaux affichent ensuite un **refresh token**. Recopie-le dans une
   variable `YOUTUBE_REFRESH_TOKEN` du même service : l'autorisation devient
   permanente, plus aucune manipulation ensuite.
4. Une fois YouTube fonctionnel, tu peux repasser la recherche dessus en
   mettant `MUSIC_SEARCH_ENGINE=youtube` sur le service du **bot** — SoundCloud
   reste le choix par défaut tant que tu ne fais rien.

Tant que `YOUTUBE_OAUTH` n'est pas défini, rien de tout cela ne s'active : le
bot fonctionne exactement comme aujourd'hui.

### Ce qui se passe si le nœud tombe quand même

Le bot ne reste plus muet en attendant une intervention :

- il surveille l'état du nœud toutes les 30 s et relance la connexion lui-même
  quand la bibliothèque a cessé de retenter ;
- si c'est le WebSocket du bot qui saute, Lavalink garde les lecteurs en vie
  pendant 30 s (`resume`) et la lecture n'est même pas interrompue — un arrêt
  volontaire du bot, lui, ferme les lecteurs au lieu de les laisser en plan ;
- si c'est le nœud qui est mort, le bot recrée les lecteurs et **relance chaque
  piste à la position où elle en était** (`resumeByLibrary`) dès qu'il est revenu ;
- une piste bloquée ou en échec ne fige plus la file : le bot la relance une
  fois par une recherche « titre + artiste », puis enchaîne sur le morceau
  suivant en expliquant ce qui n'a pas marché ;
- le panel « En cours de lecture » ne reste plus figé à 0:00 sur un morceau
  mort : il passe à « Lecture arrêtée » quand il n'y a plus rien à jouer.

Ce chemin de reprise est couvert par `node scripts/test-deadtrack.js` (il ne se
déclenche qu'en cas de panne réelle, impossible à provoquer à la main sans
casser une lecture en cours).

## 3. Intents & permissions à activer

Sur le portail développeur Discord, dans l'onglet **Bot** :
- ✅ SERVER MEMBERS INTENT — nécessaire pour `!join` (lit la présence des membres)
- ✅ PRESENCE INTENT — nécessaire pour `!join` (détecte l'activité "écoute Spotify")
- ✅ MESSAGE CONTENT INTENT — nécessaire pour les commandes textuelles (`?play`, `&clear`...)
- Rien à activer pour **GUILD_MODERATION** (journal de logs, section 6ter) :
  non privilégié, coché automatiquement par le code, aucune action manuelle.

Permissions à cocher lors de l'invitation du bot (OAuth2 URL Generator) :
- `bot`, `applications.commands`
- Connect, Speak, Send Messages, Embed Links, Use Slash Commands
- Modération (section 6ter) : Kick Members, Ban Members, Moderate Members
  (timeout), Manage Nicknames, Manage Roles, Manage Channels, Manage Messages
- Move Members — pour déplacer un membre dans son salon vocal temporaire
  fraîchement créé (section 6septies)
- View Audit Log — pour le journal de modération (section 6ter), l'anti-nuke
  (section 6sexies) et pour attribuer les débannissements à qui de droit

## 4. Déployer les commandes slash

```bash
npm run deploy
```

## 5. Lancer le bot

```bash
npm start
```

Au démarrage, le bot affiche le commit qu'il fait tourner :

```
✅ Connecté en tant que xd#1234
[version] 52e5b01 sur main — feat: menus déroulants pour le giveaway
```

Ça vient des variables `RAILWAY_GIT_*`, que Railway ne renseigne que si le
service est **branché sur le dépôt GitHub** (Settings > Source > Connect
Repo). Déployé autrement (`railway up` depuis un poste) la ligne dit
`commit inconnu` : c'est le signe que les pushs sur `main` ne déclenchent
rien et qu'il faudra redéployer à la main à chaque fois.

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

En plus des commandes slash musique, le bot répond aux préfixes texte
(configurables par serveur via `&panel` > Préfixes) :

- **`?`** (préfixe musique par défaut) : `?play`, `?join`, `?skip`, `?stop`,
  `?pause`, `?resume`, `?queue`, `?volume 80`, `?loop queue`, `?help`.
- **`&`** (préfixe des commandes, par défaut — **partagé avec le CrowBot du
  serveur** : le bot reste muet sur tout ce qu'il ne connaît pas, pour ne
  jamais répondre à sa place) :
  - **Publiques**, sans permission : `&pic`/`&avatar [@membre]`,
    `&banner [@membre]`, `&server`/`&serverinfo`, `&userinfo [@membre]`,
    `&snipe`.
  - **Utilitaires**, sans permission non plus — elles ne font que lire (voir
    section 6nonies) : `&alladmins`, `&botadmins`, `&boosters`,
    `&rolemembers <rôle>`, `&user [@membre]`, `&member [@membre]`,
    `&vocinfo`, `&emoji <émoji>`, `&calc <calcul>`, `&wiki <mot-clé>`,
    `&search wiki <mot-clé>`.
  - **Modération**, chacune sa propre clé de permission (voir section 6ter
    ci-dessous) : `&clear`/`&purge`, `&kick`, `&ban`, `&unban`, `&softban`,
    `&timeout`, `&untimeout`, `&banall`, `&modlogs`.
  - **Salons** : `&lock`/`&unlock [#salon]`, `&slowmode <durée|off>
    [#salon]`, `&hide`/`&unhide`/`&renew`, `&lockdown`/`&panic`,
    `&unlockdown`.
  - **Membres** : `&nick @membre <pseudo>`, `&resetnick @membre`,
    `&addrole @membre @rôle`, `&delrole @membre @rôle`.
  - **Admin** : `&panel` (rubriques visibles selon tes droits — voir
    section 6ter), `&sources` (diagnostic audio, rang sys uniquement),
    `&owners`, `&whitelist`, `&allbots`, `&antinuke` (voir section 6sexies).
  - **Serveur** : `&role create|delete|rename|color|admin`, `&channel
    create|delete|rename|topic`, `&dero`, `&voicehub` (voir section
    6quinquies/6septies).
  - **Communauté** : `&ticket setup`, `&poll`, `&giveaway start|reroll`
    (voir section 6octies).
  - **Public** (dans ton propre salon vocal temporaire) : `&vc lock|unlock|
    limit|rename|kick` (voir section 6septies).
  - Sans préfixe, ouvert à tout le monde (rate-limité) : `uo clear` / `anas
    clear` / `yanis clear` — efface les messages de son PROPRE auteur
    uniquement, sans rapport avec `&clear` (voir `utils/selfClear.js`).

`&help` n'affiche que ce que tu as réellement le droit d'utiliser — même
moteur de permissions que les commandes et que `&panel`, jamais une liste
séparée qui pourrait diverger (voir section 6ter).

Il distingue aussi les commandes **actives** de celles qui sont seulement
**documentées**. Le catalogue liste volontairement des commandes sans backend
(demande explicite : "intègre tout, même sans backend"), mais les afficher à
l'identique revenait à promettre qu'elles répondent — alors que les taper ne
produit rien, silencieusement. Chaque catégorie annonce donc son nombre réel
d'actives, et les autres sont regroupées sous *"Documentées, pas encore
actives"*.

La distinction est calculée depuis la **vraie** table de dispatch
(`utils/implementedCommands.js` lit `MOD_COMMAND_NAMES`), pas depuis une
liste tenue à la main : une commande qui gagne un backend quitte
automatiquement la liste des inactives, et `scripts/test-help-honesty.js`
échoue si les deux se contredisent.

Enfin, `&help` liste **un nom de commande par ligne**, jamais le même deux
fois :

- les **alias** sont collés à leur commande (`pic/avatar`,
  `server/serverinfo`, `userinfo/member`, `mute/cmute`) au lieu d'occuper
  leur propre entrée — découvrables, sans laisser croire à deux
  fonctionnalités distinctes ;
- les **sous-commandes** d'un même dispatcher (`server`, `server pic`,
  `server banner`) se replient sur leur nom de commande ;
- une commande dont les sous-commandes ont des permissions différentes
  (`&clear`, `&role`) n'apparaît que dans le palier le plus ouvert, celui
  qui décrit ce qu'on peut réellement lancer.

Le test échoue aussi si un alias est annoncé sans avoir de handler — c'est
ce qui a révélé que `lockall`/`unlockall`, documentés comme alias de
`&lockdown`/`&unlockdown`, n'avaient jamais été câblés.

Ces commandes texte nécessitent que l'intent **MESSAGE CONTENT** soit bien
activé sur le portail développeur (voir section 3).

### Persistance des données (`DATA_DIR`)

Tout ce que `&panel` change (permissions par rôle, préfixes, salons de logs,
accès, historique de modération, config anti-spam) est écrit en fichiers
JSON plats dans `data/` — aucune vraie base de données. Le disque du
container Railway étant **réinitialisé à chaque redéploiement**, pointe
`DATA_DIR` (variable d'env) vers un **Volume Railway** monté si tu veux que
ça survive aux mises à jour du bot ; sans ça, tout repart de zéro à chaque
push.

## 6ter. Permissions, rôles, logs et panel

Refonte du 30/08/2026 : un moteur de permissions **central**, par rôle et par
serveur, remplace le champ ad hoc qui gatait chaque commande individuellement.
Une seule vérité, utilisée partout — commandes, `&help`, `&panel`,
boutons — jamais deux listes qui pourraient se contredire.

### Le principe

Chaque commande de modération exige une **clé de permission** (ex :
`moderation.clear`, `moderation.ban`, `channels.lock` — liste complète dans
`utils/permissions/catalog.js`). Une clé s'accorde à un **rôle Discord**
(l'octroi normal, depuis `&panel` > Permissions) ou, plus rarement, à un
utilisateur précis. `&help` et `&panel` filtrent tous deux sur cette même
clé : ce que tu vois, tu peux réellement l'utiliser.

**Statut prioritaire inchangé** : le propriétaire du bot (`BOT_OWNER_IDS`) et
le rang sys (accordé via `&panel` > Rang sys, comme avant cette refonte) ont
toujours accès à tout, sans configuration — c'est le système historique de
`utils/accessStore.js`, volontairement conservé tel quel. `&banall` reste un
cas à part : jamais accordable par rôle ni hérité du rang sys, uniquement un
par un via `&panel` > Ban de masse.

**Aucune notion de "session" à gérer** : le panel reste un panneau Discord
natif (Components V2), pas un site web — il n'y a donc rien à connecter ni
de session à révoquer. Chaque clic revérifie les droits **en direct** contre
les rôles Discord actuels de la personne : retirer un rôle coupe l'accès
immédiatement, en redonner un le restaure, sans redémarrage ni action
manuelle.

Ses seize rubriques sont regroupées en **six familles** : le menu principal
propose les familles, un second menu n'apparaît que pour choisir à l'intérieur
d'une famille qui en contient plusieurs. Les écrans, eux, ne sont **pas**
fusionnés — chacun garde ses contrôles et ses avertissements. « Rang sys » et
« Ban de masse » voisinent dans la même famille sans jamais partager le même
écran : l'un donne accès à tout le bot, l'autre bannit le serveur entier.

| Famille | Rubriques |
|---|---|
| Accueil | Vue d'ensemble |
| Permissions et accès | Permissions, Rôles, Accès panel, Rang sys, Ban de masse |
| Protection | Protection, Anti-nuke, Mute |
| Logs et historique | Logs, Historique |
| Communauté | Bienvenue, Tickets, Vocaux |
| Réglages du bot | Préfixes, Dispenses |

`&panel` est un **poste de commande**, pas une documentation : chaque
rubrique affiche l'état courant (une ligne `> **Réglage** : valeur` par
réglage) et les contrôles qui le modifient — menus déroulants, sélecteurs de
salon/rôle/membre, boutons. Le "pourquoi" et le "comment" sont ici, dans ce
README, et dans `&help` : on peut les lire sans faire défiler un écran de
contrôles.

Deux exceptions assumées : la rubrique **Logs** dit quand on est en lecture
seule (sinon les contrôles absents seraient inexplicables), et **Ban de
masse** garde son avertissement — c'est le seul écran dont un mauvais clic
bannit le serveur entier. `scripts/test-panel-controls.js` échoue si une
rubrique se remet à expliquer au lieu de montrer.

#### Logs en commandes texte

Tout ce que fait `&panel` > Logs se fait aussi en tapant, avec la clé
`logs.manage` :

| Commande | Catégorie de logs |
|---|---|
| `&modlog on\|off [salon]` | Modération |
| `&memberlog on\|off [salon]` | Membres (arrivées/départs) |
| `&rolelog on\|off [salon]` | Rôles |
| `&channellog on\|off [salon]` | Salons |
| `&voicelog on\|off [salon]` | Vocal |
| `&serverlog on\|off [salon]` | Serveur |
| `&botlog on\|off [salon]` | Bots |
| `&messagelog on\|off [salon]` | Messages (édition/suppression) |

Sans `on`/`off`, la commande affiche l'état courant. Sans salon, `on` prend
le salon où elle est tapée. Un salon vocal, ou un salon où le bot ne peut pas
écrire, est **refusé explicitement** plutôt que d'accepter une configuration
qui ferait disparaître les logs en silence.

`&settings` résume les huit catégories, et `&autoconfiglog` crée les salons
manquants — la même fonction que le bouton du panel
(`utils/logChannels.js`), pas une seconde version.

#### Configuration en commandes texte

Les rubriques qui n'avaient pas d'équivalent tapable en ont un :

| Commande | Rubrique | Clé |
|---|---|---|
| `&prefix <préfixe>` | Préfixes | `sys` |
| `&set perm <clé> <@rôle\|@membre>` | Permissions | `panel.permissions.manage` |
| `&del perm <clé> <@rôle\|@membre>` | Permissions | idem |
| `&clear perms <@rôle\|@membre>` | Permissions | idem |
| `&join settings` | Bienvenue | `server.welcome.manage` |
| `&ticket settings` | Tickets | `server.tickets.manage` |
| `&tempvoc` | Vocaux | `server.voice.manage` |
| `&clear limit` | Dispenses | `sys` |

`&set perm` accorde en une ligne ce que le panel demande en trois menus, et
une clé inconnue renvoie la liste des clés valides plutôt qu'un refus sec. Un
préfixe de plus de 3 caractères, ou contenant une espace, est refusé : il
rendrait toutes les commandes intapables.

### `&panel` — rubriques

Chaque rubrique n'apparaît que si tu y as droit :

- **Permissions** — choisis un rôle, puis coche les permissions à lui
  accorder dans un menu (remplace l'ensemble actuel en un envoi).
- **Profils** — applique un profil prédéfini (**Helper**, **Modérateur**,
  **Admin** — `utils/permissions/profiles.js`) à un rôle en un clic ; c'est
  un octroi en masse ponctuel, pas un lien permanent — le résultat reste
  éditable ensuite permission par permission depuis la rubrique
  Permissions.
- **Rôles** — nom, ID, couleur, position, nombre de membres, permissions
  Discord notables et permissions de modération accordées, pour n'importe
  quel rôle du serveur.
- **Logs** — un salon par catégorie (**Modération**, **Membres**,
  **Serveur**, **Bots**, **Messages**) plutôt qu'un seul pour tout ; voir
  plus bas. Bouton "Créer les salons automatiquement" : crée les salons
  manquants (regroupés dans une catégorie "Logs"), masqués à `@everyone` —
  seuls les membres avec la permission Discord **Administrateur** les
  voient, celle-ci passant outre toute restriction de salon, rien d'autre à
  faire.
- **Historique** — 5 dernières actions en aperçu, plus un bouton
  "Rechercher" (fenêtre modale : cible / modérateur / type / ID) ; ou en
  texte via `&modlogs [@membre|id]`.
- **Protection** — active/désactive l'anti-spam et gère sa whitelist (voir
  section 6quater).
- **Accès panel** — qui a un accès individuel (rang sys, ban de masse,
  octrois précis), statut membre/parti, et un bouton pour nettoyer les
  accès obsolètes (voir plus bas).
- **Rang sys** / **Ban de masse** — réservées au propriétaire du bot,
  inchangées.

### Nettoyage des accès obsolètes

Quand quelqu'un quitte le serveur, ses octrois individuels et ses portées
historiques (rang sys, ban de masse, dispense de nettoyage) sont retirés
**automatiquement** (`guildMemberRemove`, voir `index.js` et
`utils/permissions/cleanup.js`) — sauf s'il est encore membre d'un autre
serveur où tourne le bot, pour ne pas couper un accès encore légitime
ailleurs. S'il revient, son accès se **recalcule** sur ses rôles actuels :
les octrois par rôle n'ont jamais rien eu à "restaurer", ils suivent le rôle,
pas la personne. Le bouton "Nettoyer les accès obsolètes" de `&panel` >
Accès panel ne sert qu'à rattraper un cas resté en place avant l'existence
de ce mécanisme. **L'historique de modération n'est jamais touché** par ce
nettoyage : on retire l'accès, pas les traces.

### Journal de modération et historique

Le salon de logs (par catégorie, voir plus haut) reçoit un message
**permanent** (il ne s'efface jamais, contrairement aux confirmations
ailleurs dans le bot) pour : bannissement, débannissement, expulsion,
softban, timeout, rôles ajoutés/retirés (avec le détail des rôles
concernés), pseudo modifié, mode lent, salon créé/supprimé/renommé (type,
catégorie, NSFW, topic), rôle créé/supprimé/renommé (couleur, mentionnable,
affiché séparément, position), verrouillage de salon, webhook créé,
nettoyage en masse, bot ajouté, déconnexion vocale forcée, et suppression
d'un message précis avec son contenu (catégorie **Messages**, alimentée par
le même mécanisme que `&snipe` — le message doit avoir été vu en cache par
le bot, Discord ne retient le contenu d'un message supprimé nulle part
côté serveur).

Chaque entrée suit la même présentation : titre, une ligne par champ
("**Label :** valeur", avec de vraies mentions Discord cliquables pour les
membres/salons), **Auteur** et **Raison** ajoutés automatiquement à la fin
quand ils sont connus, et un horodatage en petit texte tout en bas.

Deux sources, sans doublon :
- les commandes de **ce bot** (`&kick`, `&ban`, `&timeout`...) journalisent
  directement, avec le VRAI modérateur (`utils/moderation/actions.js`) ;
- tout le reste — **CrowBot**, ou n'importe quel modérateur humain via le
  client Discord natif — est capté par le **journal d'audit natif de
  Discord** (`guildAuditLogEntryCreate`, intent **GUILD_MODERATION**, non
  privilégié, aucune activation manuelle requise), qui retient l'exécuteur
  réel de chaque action.

**Point d'attention Discord, pas un bug** : quand CE bot agit, Discord
journalise l'action sous le compte du bot lui-même, jamais sous celui de la
personne qui a tapé la commande — c'est pour ça que les deux sources
existent séparément (le relais d'audit ignore explicitement ses propres
actions, déjà couvertes par la première voie avec la bonne attribution).

`&modlogs [@membre|id]` et `&panel` > Historique interrogent le même
historique centralisé (`utils/moderationHistoryStore.js`), consultable par
cible, par modérateur, par type ou par ID — recherche indépendante du
journal d'audit Discord (qui, lui, ne garde que ~45 jours et n'offre pas de
recherche structurée depuis un bot).

Nécessite la permission **View Audit Log** sur le bot (voir section 3).

## 6quater. Protection légère et lockdown

CrowBot couvrant déjà l'anti-nuke (bans/kicks/salons/rôles en masse,
webhooks, bots non autorisés, afflux de joins) et l'essentiel de l'automod
(liens, `@everyone`), ce bot n'ajoute volontairement **que** ce qui manque,
pour ne pas devenir une copie :

- **Anti-spam/anti-flood** (`utils/automod/antiSpam.js`) — désactivé par
  défaut, par serveur ; met en timeout un membre qui envoie trop de
  messages trop vite (seuils réglables uniquement dans le code pour
  l'instant, la bascule marche/arrêt et la whitelist sont dans `&panel` >
  Protection).
- **`&lockdown` / `&panic`** — verrouille l'écriture (`SendMessages`) sur
  tous les salons textuels que le bot peut gérer ; `&unlockdown` inverse.
  Simplification assumée : pas de liste de salons à configurer séparément,
  c'est un vrai bouton de panique qui verrouille tout d'un coup.

Aucun anti-raid/anti-nuke complet n'est reconstruit ici — c'est le rôle du
CrowBot du serveur, et le dupliquer n'apporterait rien.

### Anti-spam en commandes texte

`&antispam on|off` active la surveillance ; `&antispam <nombre>/<durée>`
règle le seuil (`&antispam 5/10` = 5 messages en 10 secondes). Les valeurs
sont bornées — de 2 à 50 messages, sur 1 à 60 secondes : en dessous, le
moindre double envoi sanctionnerait ; au-delà, ce n'est plus du flood mais
une conversation. Un seuil hors bornes est refusé avec le message qui le dit,
plutôt qu'accepté et silencieusement inopérant.

`&spam allow [#salon]` exempte un salon de l'anti-spam (salon de flood
assumé), `deny`/`reset` le remettent sous surveillance. Même forme que
`&link` pour l'anti-lien.

Sans argument, `&antispam` affiche l'état, le seuil et les salons exemptés.
Régler un seuil alors que l'anti-spam est désactivé le signale : sinon on
croirait avoir posé une protection qui ne tourne pas.

## 6quinquies. Administration du serveur et bienvenue

Outils de structure du serveur (créer/supprimer/modifier rôles et salons),
distincts de la détection anti-nuke (qui reste chez CrowBot, voir
7quater) : ici, pas de surveillance, juste des commandes directes,
chacune avec sa propre clé de permission (catégorie **Serveur** dans
`&panel` > Permissions).

- **`&role create <nom>`** / **`&role rename @rôle <nom>`** /
  **`&role color @rôle <hex>`** — clé `server.roles.manage`.
- **`&role delete @rôle`** — même clé, **confirmation obligatoire**
  (irréversible).
- **`&role admin @rôle`** — donne ou retire la permission Discord
  **Administrateur** au rôle. Clé à part, `server.roles.admin_grant`,
  **jamais octroyable par rôle** (comme `&banall`) — seuls le rang sys et
  le propriétaire du bot y ont accès, jamais un octroi délégué. C'est la
  commande la plus sensible du bot : Administrateur passe outre toutes
  les restrictions de salon, donner ce rôle à la mauvaise personne donne
  un contrôle total du serveur. Confirmation obligatoire à chaque usage.
- **`&channel create <nom> [vocal]`** / **`&channel rename [#salon]
  <nom>`** / **`&channel topic [#salon] <texte>`** — clé
  `server.channels.manage`.
- **`&channel delete [#salon]`** — même clé, **confirmation obligatoire**.
- **`&owners`** — liste paginée du rang sys (équivalent dédié à `&panel` >
  Rang sys) ; ajout/retrait réservés au propriétaire du bot, comme partout
  ailleurs dans le bot.
- **`&whitelist`** — liste paginée des membres exemptés de l'anti-spam
  (clé `protection.whitelist`, équivalent dédié à `&panel` > Protection).
- **`&allbots`** — liste paginée de tous les comptes bot présents sur le
  serveur (rang sys, lecture seule).
- **`&dero role @rôle`** / **`&dero off`** — un rôle qui reçoit
  automatiquement Voir le salon/Envoyer des messages/Se connecter sur
  **chaque nouveau salon créé** sur le serveur, sans action manuelle
  (clé `server.dero.manage`).

Toute suppression (rôle, salon) et le don d'Administrateur passent par un
panneau de confirmation dédié — jamais d'action irréversible sur un seul
clic. Les autres commandes de cette section (renommer, changer une
couleur, créer) s'exécutent directement, comme `&clear`/`&renew` : leur
effet est mineur ou facilement corrigé, une confirmation n'apporterait
que de la friction.

### Bienvenue (`&panel` > Bienvenue)

Message envoyé au salon configuré à l'arrivée d'un membre, tiré au hasard
parmi une liste (clé `server.welcome.manage`) : salon cible, délai de
suppression automatique (10s/30s/1min/5min/jamais), messages ajoutés via
une fenêtre de saisie et retirés depuis un menu. Le nouvel arrivant est
**toujours mentionné, avec notification** (seul cas du bot qui ping,
contrairement au reste qui n'en envoie jamais) : la mention est placée
devant le message par défaut, ou à l'endroit de `{user}` dans le texte si
tu veux la positionner ailleurs (ex : "Bienvenue {user}, lis le
règlement !"). Désactivé tant qu'aucun salon ou aucun message n'est
configuré.

## 6sexies. Anti-nuke (`&antinuke`, `&panel` > Anti-nuke)

**Désactivé par défaut.** Détecte des rafales d'actions destructrices
(création/suppression de salons ou de rôles, bannissements, expulsions,
débannissements — 3 en 10s) et certaines actions immédiates, dangereuses
dès la première fois (ajout de bot non autorisé, création de webhook,
mention `@everyone`/`@here`, permission **Administrateur** donnée à un
rôle). L'exécuteur est identifié via le journal d'audit Discord — comme
`utils/moderationLog.js`, dont l'anti-nuke est indépendant (une même
entrée d'audit alimente les deux, sans lien entre eux).

- **Sanction** configurable : `timeout` (10 min, par défaut — la moins
  destructrice), `kick` ou `ban`. `&antinuke punishment <valeur>` ou
  bouton dans le panel.
- **Owner, rang sys et whitelist sont exemptés en entier** — pas
  seulement de la sanction : leurs actions ne comptent même pas dans les
  seuils, rien n'est jamais annulé chez eux. Whitelist par utilisateur
  dans `&panel` > Anti-nuke, par rôle via `&antinuke wlrole @rôle`.
- **Restauration automatique** seulement pour les bannissements/
  débannissements (débannir/rebannir immédiatement, action simple et sans
  risque). **Pas de recréation de salon/rôle supprimé à l'identique** en
  l'état actuel — détection et sanction seulement pour ces cas-là :
  recréer une structure fidèlement (permissions, position, catégorie)
  demanderait de maintenir des instantanés en continu, une complexité
  qui n'a pas semblé justifiée pour une première version.
- **Plafond de 5 sanctions par minute et par serveur**, tous guards
  confondus : en pleine réponse à un vrai raid, le moteur ne part pas
  lui-même dans une rafale de kicks/bans qui ressemblerait à un nuke aux
  yeux du CrowBot.

#### Anti-nuke en commandes texte

Tout ce que fait `&panel` > Anti-nuke se fait aussi en tapant, avec la clé
`protection.guard.manage` :

- **Interrupteur général** : `&secur on|off` (alias de `&antinuke on|off`).
  Sans argument, il résume l'état — sanction, guards actifs, taille de la
  whitelist.
- **Un guard, une commande** : `&antibot`, `&antiwebhook`, `&antiroleadmin`,
  `&antichannel`, `&antichanneldelete`, `&antirole`, `&antiroledelete`,
  `&antikick`, `&antiban`, `&antiunban`, `&antieveryone`, `&antijoin` —
  chacune en `on|off` (`max` accepté comme synonyme de `on` : ces guards sont
  binaires, il n'y a pas de palier intermédiaire). Sans argument, la commande
  affiche l'état du guard et son seuil de déclenchement.
- **Sanction** : `&punition all <timeout|kick|ban>`. Elle est **globale** —
  ce bot ne règle pas la sanction guard par guard, et le dit plutôt que
  d'ignorer un premier argument qui laisserait croire le contraire.
- **Whitelist** : `&wl [@membre|@rôle|ID]` pour ajouter ou afficher la liste,
  `&unwl` pour retirer. Distincte de `&whitelist`, qui est celle de
  l'anti-spam.

`on` est un réglage explicite, pas une bascule : taper `&antibot on` deux
fois laisse le guard actif. Et activer un guard alors que l'interrupteur
général est coupé le signale — sinon on croirait avoir posé une protection
qui ne se déclenchera jamais.

### CrowBot tourne aussi son propre anti-nuke sur ce serveur

**Ajoute le compte du CrowBot à la whitelist de cet anti-nuke** (`&panel`
> Anti-nuke, ou `&antinuke` puis ajouter son ID). Sans ça, une action
légitime du CrowBot (débannir quelqu'un dans le cadre de son propre
anti-nuke, par exemple) peut être vue comme suspecte ici et annulée par
erreur — les deux bots agissant chacun de leur côté sur le même serveur,
sans se coordonner.

## 6septies. Salons vocaux temporaires (`&voicehub`, `&vc`)

`&voicehub #salon-vocal` (clé `server.voice.manage`) désigne un salon
"générateur" : le rejoindre crée aussitôt un salon vocal personnel
("Salon de {pseudo}", dans la même catégorie) et y déplace le membre.
Supprimé automatiquement dès qu'il se vide — pas de nettoyage manuel à
faire. `&voicehub off` désactive.

Dans son propre salon temporaire, le membre qui l'a créé (ou le rang
sys/le propriétaire du bot) peut le gérer sans permission particulière —
c'est une question de propriété, pas de rôle :

- `&vc lock` / `&vc unlock` — autorise/interdit `@everyone` à s'y connecter.
- `&vc limit <n>` — limite de places (0 = illimité).
- `&vc rename <nom>` — renomme le salon.
- `&vc kick @membre` — déconnecte quelqu'un de CE salon précisément.

## 6octies. Communauté : tickets, sondages, giveaways

**Tickets** (`&ticket setup [@role-staff]`, clé `server.tickets.manage`) —
poste un message "Ouvrir un ticket" dans le salon courant. Un clic crée un
salon privé (visible du demandeur, du rôle staff et du bot uniquement),
avec un bouton "Fermer" dedans (demandeur, staff, ou `server.tickets.manage`).
Un membre ne peut avoir qu'un ticket ouvert à la fois.

**Sondages** (`&poll "question" "option1" "option2" [...]`, 2 à 5 options,
clé `server.polls.manage`) — un bouton par option, un vote par personne
(revoter change le vote), résultats en direct sous forme de barres. Vivent
en mémoire, pas en base : redémarrer le bot remet les sondages en cours à
zéro — une activité ponctuelle et courte, pas une donnée à conserver.

**Giveaways** (`&giveaway start <durée> <lot>`, clé
`server.giveaways.manage`) — bouton "Participer" (rejoindre/quitter), tirage
automatique au terme (vérifié toutes les 30s), annonce du ou des gagnants
dans le salon. **Persistés** (contrairement aux sondages) : un redéploiement
pendant qu'un giveaway est en cours ne le fait pas disparaître. `&giveaway
reroll [id]` retire un nouveau gagnant du dernier giveaway du salon (ou d'un
giveaway précis par ID de message).

Tapé sans tout son paramétrage, `&giveaway` ouvre sa **carte** (voir section
6bis) : durée, lot et nombre de gagnants s'y choisissent dans des **menus
déroulants** plutôt qu'en tapant du texte, chacun gardant une option
**"Autre"** qui rebascule ce seul champ sur une réponse écrite dans le salon
— les listes couvrent les cas courants sans jamais les imposer.

- **Durée** : de `1m` à `7d`, ou une durée libre via "Autre".
- **Lot** : quelques suggestions, ou n'importe quel texte via "Autre".
- **Nombre de gagnants** : 1 à 10 dans la liste (jusqu'à 20 en écrivant le
  nombre). Les gagnants sont tirés **distincts** — personne ne peut remporter
  deux fois le même giveaway — et s'il y a moins de participants que de
  gagnants demandés, tous gagnent.
- **Rôle requis pour participer** *(facultatif)* : restreint le bouton
  "Participer" aux membres ayant ce rôle. Le contrôle est refait à **chaque
  clic**, donc quelqu'un qui perd le rôle entre-temps ne peut plus rejoindre.

La commande **tapée** garde exactement sa syntaxe d'origine
(`&giveaway start 1h Nitro` — un gagnant, ouvert à tous) : le nombre de
gagnants et le rôle requis n'existent que sur la carte, plutôt que d'inventer
des drapeaux texte que personne n'a demandés.

## 6nonies. Utilitaires de consultation

Onze commandes en **lecture seule** : elles n'écrivent jamais rien sur le
serveur, donc aucune ne demande de permission — même famille que `&pic` ou
`&userinfo`. Contrairement aux commandes de modération, elles **répondent**
quand on les tape mal : le silence sur le préfixe `&` sert à ne pas parler à
la place du CrowBot, et aucun de ces noms ne lui appartient.

### Listes de membres

`&alladmins` (humains administrateurs), `&botadmins` (bots administrateurs —
la surface d'attaque la plus large du serveur), `&boosters` (du boost le plus
ancien au plus récent) et `&rolemembers <rôle>` (mention, ID **ou** nom du
rôle) partagent la carte paginée déjà utilisée par `&owners`/`&whitelist`/
`&allbots` (`utils/listCard.js`), 10 entrées par page.

Le contenu de ces listes est défini une seule fois, dans
`utils/readOnlyLists.js`, et sert **deux** chemins qui ne peuvent donc plus
diverger : la commande texte qui poste la première page, et le sélecteur de
page de la carte. Rien n'est gardé en mémoire entre les deux — le rôle visé
voyage dans le `customId` (`srv:page:rolemembers/<id>`) et tout est recalculé
au clic, si bien que la carte reste utilisable même après un redémarrage du
bot. Au passage, `&allbots` gagne une pagination qui **fonctionne** : son
sélecteur de page était affiché mais sans effet.

### Fiches d'information

- `&user [@membre]` décrit le **compte Discord** : il répond donc aussi pour
  quelqu'un qui n'est pas (ou plus) sur le serveur, à partir de son ID.
- `&member [@membre]` décrit l'**appartenance au serveur** : c'est le même
  rendu que `&userinfo`, sous son deuxième nom documenté, plutôt qu'une
  seconde fiche qui divergerait à la première retouche.
- `&vocinfo` donne l'état vocal du serveur : connectés, micros/casques
  coupés, partages d'écran, et le détail des salons occupés.
- `&emoji <émoji>` récupère l'image d'un émoji personnalisé donné en émoji,
  en nom ou en ID — y compris un émoji venu d'un **autre** serveur, dont
  l'URL CDN est reconstruite. Un émoji Unicode (😀) n'a aucune image à
  récupérer : il est dessiné par l'appareil du lecteur, et la commande le dit
  au lieu d'échouer sans explication.

### `&calc` — calculatrice

Parenthèses, `+ - * / % ^`, multiplication implicite (`3(4+1)`, `2x`),
virgule décimale, constantes `pi`/`e` et fonctions `sqrt`, `abs`, `round`,
`floor`, `ceil`, `ln`, `log`, `exp`, `sin`, `cos`, `tan`. Une entrée
contenant `=` est traitée comme une **équation du premier degré** à une
inconnue `x` (`&calc 2x+3=7` → `x = 2`) ; une équation d'un autre degré est
refusée explicitement plutôt que résolue de travers.

L'expression est analysée par un parseur écrit à la main
(`utils/calc.js` : tokenizer + shunting-yard), **jamais** par `eval()` ni
`new Function()`. L'entrée vient de n'importe quel membre du serveur, et il
n'existe aucune façon sûre d'exécuter ça comme du JavaScript : ici, un
caractère hors de la grammaire est une erreur, pas du code.

### `&wiki` et `&search wiki`

`&wiki <mot-clé>` affiche le résumé de l'article Wikipédia francophone
correspondant (titre, extrait tronqué à 1000 caractères, vignette, lien) ;
`&search wiki <mot-clé>` liste jusqu'à 10 articles proches. Les appels
(`utils/wikipedia.js`) sont coupés au bout de 8 secondes, un article
introuvable est distingué d'une panne, et Wikipédia injoignable donne un
message clair au lieu d'un plantage silencieux.

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

## 7ter. `&ban` / `&unban` / `&banall` — bannissement

- `&ban [@membre] [raison]` — clé `moderation.ban`. Sans cible : panneau
  **Zinki Assassini** avec un menu de sélection des membres. Avec une cible
  (mention ou ID) : saut direct à la confirmation. Vérifie la hiérarchie
  (rôle du modérateur, rôle du bot, protections propriétaire/rang sys) avant
  d'afficher le panneau ET juste avant l'action — la situation peut changer
  entre les deux.
- `&unban [id]` — clé `moderation.unban`. Sans identifiant : menu déroulant
  des membres actuellement bannis. Aucune confirmation : l'action se défait
  d'elle-même en rebannissant.
- `&banall [raison]` — clé spéciale `moderation.banall`, **jamais**
  accordable par rôle ni héritée du rang sys (voir section 6ter) : seul le
  propriétaire du serveur ou un octroi individuel via `&panel` > Ban de
  masse y donne accès. Bannit tout le serveur d'un coup (API de masse
  Discord si la permission **Gérer le serveur** est accordée, sinon un par
  un avec anti-rate-limit), avec confirmation obligatoire.

Aucune commande slash `/ban`/`/unban` : ces commandes sont volontairement
restées en texte, cohérentes avec le reste de la modération.

Nécessite les intents **SERVER MEMBERS** et **PRESENCE** activés (voir
section 3) — sans ça, `member.presence` est toujours vide côté Discord.js et
`!join` répondra systématiquement "n'écoute rien sur Spotify", même si c'est
faux.

## 7quater. Ce que ce bot ne fait pas (par choix, pas par limitation)

Demande explicite du 30/08/2026, revenant sur le choix initial de rester
complémentaire au CrowBot du serveur (dépôt séparé `discord-bot-2`) :
l'anti-nuke (section 6sexies) et les salons vocaux temporaires
(section 6septies) sont maintenant construits ici aussi. Restent
volontairement absents — vraie limitation de temps/complexité, pas une
question de principe cette fois : blacklist réseau multi-serveurs, captcha
anti-raid, système de warns (explicitement exclu, celui-là reste un choix).
Le CrowBot continue de les couvrir.

Aucune commande sur un préfixe caché ou un mécanisme parallèle au système de
permissions décrit en section 6ter : tout, y compris `&banall` et l'anti-nuke,
passe par le même moteur central.

Parmi les commandes de la catégorie **Utilitaire** du catalogue, quatre
restent documentées sans backend, chacune pour une raison précise plutôt que
par oubli :

- `&image <mot-clé>` demande une clé d'API Google Custom Search, qui n'existe
  pas dans la configuration du bot — la câbler supposerait d'en créer une et
  d'assumer son quota.
- `&suggestion` et `&lb suggestions` ne sont pas une consultation mais une
  fonctionnalité à part entière (salon dédié, votes, stockage, classement) :
  leur place est aux côtés des tickets/sondages/giveaways de la section
  6octies, pas dans ce lot en lecture seule.
- `&changelogs` n'a aucune source à afficher : le dépôt ne tient pas de
  fichier de notes de version, et fabriquer les notes à partir des messages
  de commit donnerait un rendu illisible pour les membres du serveur.
- `&support` supposerait un serveur de support, qui n'existe pas.

Comme toutes les commandes du catalogue sans handler, elles restent listées
dans `&help`/`&panel` (demande explicite : la référence complète, backend ou
non) et ne répondent simplement rien si on les tape.

## 8. Notes sur Components V2

Components V2 nécessite `discord.js` en version **14.16+**. C'est un nouveau système
de mise en page (Container, TextDisplay, Separator...) activé via le flag
`MessageFlags.IsComponentsV2`, utilisé ici dans `utils/nowPlayingPanel.js`. Si tu as
une ancienne version de discord.js installée, fais `npm update discord.js`.
