# Valorant Customs — bot Discord

Organisation de parties personnalisées Valorant : panneau interactif en
**Components V2**, équipes, liste d'attente, salons vocaux privés et surtout
**système anti-absent** avec timer.

**Aucune commande slash** : tout passe par un préfixe, `+` par défaut, changeable
à chaud depuis le panneau de contrôle.

## Installation

```bash
cd valorant-customs
npm install
cp .env.example .env    # puis renseigne DISCORD_TOKEN
npm start
```

### Portail développeur Discord

- **Bot → Privileged Gateway Intents** : activer **Message Content Intent**
  (commandes préfixe) et **Server Members Intent** (déplacements vocaux).
- **Permissions à donner au bot** : `Gérer les salons`, `Déplacer des membres`,
  `Voir les salons`, `Envoyer des messages`, `Gérer les messages`.

### Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `DISCORD_TOKEN` | **obligatoire** — token du bot |
| `PREFIX` | préfixe initial (défaut `+`, ensuite modifiable depuis le panneau) |
| `VALORANT_EMOJI` | emoji du titre, ex. `<:valorant:123456789012345678>` |
| `BOT_OWNER_IDS` | roots supplémentaires (le propriétaire de l'application est détecté tout seul) |
| `LOG_CHANNEL_ID` | salon des logs (création, join, leave, avertissement, retrait…) |
| `STAFF_ROLE_ID` | rôle autorisé à gérer **toutes** les parties |
| `VOICE_CATEGORY_ID` | catégorie où créer les salons d'équipe |
| `WARN_SECONDS` | durée de l'avertissement anti-absent (défaut `60`) |
| `PROMOTE_SECONDS` | délai de réponse pour la place proposée (défaut `60`) |
| `AUTO_PROMOTE` | `true` = pas de confirmation, la place est donnée directement |
| `WARN_ACCEPT_ANY_VOICE` | `true` = avant le lancement, n'importe quel vocal vaut présence |

## Structure

```
valorant-customs/
├── index.js                  # point d'entrée : intents, chargement, arrêt propre
├── config.js                 # couleurs, emojis, formats, maps, délais
├── commands/
│   ├── custom.js             # +custom  — crée la partie + panneau interactif
│   ├── avertir.js            # +avertir — déclenche le timer anti-absent
│   ├── move.js               # +move    — force le déplacement vocal
│   ├── panel.js              # +panel   — panneau de contrôle (propriétaires)
│   ├── profil.js             # +profil  — pseudo Valorant + rang
│   └── aide.js               # +aide    — liste des commandes
├── events/
│   ├── ready.js              # purge + reprise des timers après redémarrage
│   ├── messageCreate.js      # commandes préfixe (préfixe relu à chaque message)
│   ├── interactionCreate.js  # routage boutons / menus / modales
│   └── voiceStateUpdate.js   # annule l'avertissement dès que le joueur arrive
├── utils/
│   ├── display.js            # ⭐ panneau de partie en Components V2
│   ├── embeds.js             # embeds courts (avertissement, proposition…)
│   ├── reply.js              # réponses aux commandes préfixe
│   ├── matches.js            # modèle de partie + rafraîchissement du message
│   ├── matchActions.js       # actions : rejoindre, quitter, lancer, terminer…
│   ├── warnings.js           # ⭐ anti-absent : timers, retrait, liste d'attente
│   ├── panel.js              # ⭐ panneau de contrôle (vues + routage)
│   ├── access.js             # root / propriétaires / gestionnaires
│   ├── settings.js           # réglages modifiables à chaud depuis le panneau
│   ├── voice.js              # salons privés, permissions, déplacements
│   ├── ranks.js              # rangs FR + emojis + parsing tolérant
│   ├── permissions.js        # hôte / staff / permissions du bot
│   ├── logger.js             # logs salon + console
│   └── store.js              # persistance JSON atomique
└── data/                     # matches / profiles / access / settings (générés)
```

## Commandes

Préfixe par défaut `+`. Les arguments de `+custom` se donnent dans n'importe
quel ordre — le bot reconnaît tout seul un format, une map, un rang.

| Commande | Qui | Effet |
| --- | --- | --- |
| `+custom [5v5] [map] [rang] [sansmoi]` | tous | crée la partie |
| `+avertir @joueur [#id]` | hôte / responsables | lance le compte à rebours anti-absent |
| `+move @joueur [1\|2]` · `+move tous` | hôte / responsables | déplace dans le bon vocal |
| `+profil [Pseudo#TAG] [rang]` · `+profil @joueur` | tous | consulte / met à jour le profil |
| `+panel` | **root + propriétaires** | ouvre le panneau de contrôle en privé |
| `+aide` | tous | liste les commandes avec le préfixe en vigueur |

Alias disponibles : `partie`, `warn`/`afk`, `deplacer`, `pseudo`/`rang`,
`panneau`, `help`.

## Hiérarchie d'accès

| Rang | Qui le donne | Peut |
| --- | --- | --- |
| 👑 **Root** | personne — c'est le propriétaire de l'application Discord (détecté au démarrage) et/ou `BOT_OWNER_IDS` | tout, **seul à donner ou retirer l'ownership** |
| 🛡️ **Propriétaire** | le root, depuis le panneau | accès complet au bot + panneau (sauf la section Propriétaires) |
| 🔧 **Gestionnaire** | root et propriétaires | gérer *toutes* les parties (avertir, move, kick, terminer) — pas le panneau |
| 🎮 **Joueur** | par défaut | rejoindre, liste d'attente, `+profil`, créer ses parties |

Le root n'est stocké dans aucun fichier : impossible de le perdre, impossible de
se le faire retirer depuis le panneau. Chaque clic dans le panneau revérifie les
droits — un `customId` ne suffit jamais à autoriser une action.

## Le panneau de contrôle (`+panel`)

`+panel` supprime ton message et poste un bouton **Ouvrir le panneau**. Le clic
est une interaction : la réponse est donc **strictement privée**, visible de toi
seul, même dans un salon public. Quatre sections, navigables sans quitter le
message :

- 👑 **Propriétaires** *(root uniquement)* — donner / retirer l'ownership du bot.
- 🔑 **Gestionnaires** — nommer ou révoquer les gestionnaires de parties.
- 🎮 **Parties en cours** — pour chaque partie : `Kick`, `Échanger 2 joueurs`,
  `Mélanger` (répartition aléatoire équilibrée), `Rapatrier en vocal`,
  `Recréer les salons`, `Terminer`.
- ⚙️ **Réglages** — **préfixe des commandes**, délais d'avertissement et de
  réponse, attribution automatique, présence en vocal, création réservée, salon
  de logs, catégorie des vocaux. Ces réglages remplacent le `.env` à chaud, sans
  redémarrage, et sont persistés dans `data/settings.json`.

## Le système anti-absent

1. L'hôte lance `+avertir @joueur` (ou le bouton **Avertir un joueur**, avant lancement).
2. Le bot ping le joueur : *« Tu as 60 secondes pour rejoindre le salon vocal de
   ton équipe. Passé ce délai, ta place sera donnée à quelqu'un d'autre. »*
3. Le compte à rebours s'affiche en direct dans le panneau, à côté du joueur.
4. **Le joueur arrive** → l'avertissement est levé immédiatement (pas besoin
   d'attendre la fin du timer).
   **Le joueur est absent** → retrait automatique de l'équipe, message public
   `@joueur a été retiré pour absence. Une place est libre !`, puis la place est
   proposée au premier de la liste d'attente avec **Prendre la place** /
   **Passer mon tour** (60 s pour répondre, sinon on passe au suivant).

Les échéances sont persistées : un redémarrage du bot ne fait jamais « oublier »
un avertissement en cours.

## Rangs

Fer, Bronze, Argent, Or, Platine, Diamant, Ascendant, Immortel, Radiant (+ Non classé),
avec divisions 1-3. La saisie est tolérante : `plat3`, `Diamant 2`, `immo`, `nc`…

Les emojis sont des carrés Unicode par défaut. Pour les vraies icônes Valorant :
uploade-les en emojis serveur et remplace le champ `emoji` dans
[`utils/ranks.js`](utils/ranks.js) par `<:fer:123456789012345678>`.

Même principe pour le logo du titre : `VALORANT_EMOJI=<:valorant:123…>` dans le
`.env`.

## Rendu du panneau de partie

Le panneau est construit en **Components V2** (`ContainerBuilder` +
`TextDisplay` + `Separator`, `flags: MessageFlags.IsComponentsV2`) — voir
[`utils/display.js`](utils/display.js) :

```
## Partie personnalisée — Valorant
**Host** : @hôte · **Format** : 5 vs 5
────────────────────────────────
**Statut** : partie en cours — les salons vocaux des équipes ont été créés.
────────────────────────────────
**Équipe 1 — 5/5**
1. @joueur — `pseudo` · 🟫 Fer
…
────────────────────────────────
-# Les salons vocaux sont visibles par tout le monde, mais seuls les joueurs
   de chaque équipe peuvent s'y connecter, parler et stream.
[ Terminer la partie ]
```

Partie lancée : un seul bouton, comme sur la maquette. En attente : les boutons
d'inscription, `Lancer la partie` et `Avertir un joueur` s'ajoutent.
