require("dotenv").config();
const path = require("path");
const { Client, GatewayIntentBits, Collection, MessageFlags } = require("discord.js");
const { Kazagumo } = require("kazagumo");
const { Connectors } = require("shoukaku");
const { buildNowPlayingPanel, buildStoppedPanel } = require("./utils/nowPlayingPanel");
const { handleMusicTextCommand } = require("./utils/musicCommands");
const { buildStatusEmbed } = require("./utils/statusEmbed");
// Seul reliquat de modération : les déclencheurs sans préfixe "uo clear" &
// consorts (voir utils/selfClear.js). La modération à proprement parler est
// assurée par le CrowBot du serveur, d'où le retrait de &clear qui faisait
// doublon avec lui.
const { handleSelfClear } = require("./utils/selfClear");
const {
  startNowPlayingTracking,
  stopNowPlayingTracking,
  setPlayerPaused,
  getElapsedMs,
  queueAndPlay,
} = require("./utils/musicPlayer");
const favoritesStore = require("./utils/favoritesStore");
const { buildFavoritesPanel, SELECT_ID: FAV_SELECT_ID } = require("./utils/favoritesPanel");
const { getPrefixes } = require("./utils/prefixStore");
const { handleConfigInteraction } = require("./utils/configPanel");
const { buildHelpPanel, SELECT_ID: HELP_SELECT_ID } = require("./utils/helpPanel");
const { playbackErrorMessage } = require("./utils/musicErrors");
const { handleJoinSpotify } = require("./utils/joinSpotify");
const { findSpotifyActivity, getSpotifyActivity, spotifyActivityQuery, spotifyActivityElapsedMs } = require("./utils/spotifyPresence");
const { loadGuildConfig } = require("./utils/configChannel");
const { canControlPlayer, requestPlayerAccess, clearPlayerControl } = require("./utils/playerControl");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    // Nécessaires pour détecter l'activité "écoute Spotify" (!join). À
    // activer manuellement sur le portail développeur Discord (Bot >
    // intents privilégiés).
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
  ],
  // AUCUN ping par défaut, nulle part : ni @everyone/@here, ni rôles, ni
  // utilisateurs, ni ping de réponse. Les mentions restent affichées et
  // cliquables (<@id> s'affiche toujours "@pseudo"), elles ne déclenchent
  // simplement plus de notification — indispensable pour les logs et les
  // réponses de commandes, qui citent constamment des membres.
  // Le seul endroit où le ping est VOULU le demande explicitement : la
  // demande d'autorisation vocale (voir utils/playerControl.js).
  allowedMentions: { parse: [], repliedUser: false },
});

// ---- Chargement des commandes slash musique uniquement ----
const MUSIC_COMMAND_FILES = ["play.js", "pause.js", "resume.js", "skip.js", "stop.js", "queue.js", "volume.js", "loop.js"];
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
for (const file of MUSIC_COMMAND_FILES) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// ---- Initialisation de Kazagumo/Lavalink (YouTube + recherche Spotify) ----
// Le nœud Lavalink fait tout le travail audio (y compris la connexion UDP à
// Discord), ce qui contourne le blocage de l'UDP sortant sur certains hébergeurs
// (Railway inclus) : le bot ne parle au nœud qu'en WebSocket/HTTP classique.
// Les nœuds publics gratuits tombent régulièrement et sans préavis — c'est
// arrivé en pleine lecture (WebSocket fermé en boucle, puis 504). On en
// déclare donc PLUSIEURS : Shoukaku bascule tout seul sur le suivant quand
// l'un devient injoignable, au lieu de laisser la musique morte jusqu'à un
// changement manuel de LAVALINK_HOST.
// LAVALINK_HOST/PORT/PASSWORD/SECURE, s'ils sont définis, ajoutent un nœud
// prioritaire en tête de liste (utile pour un nœud privé).
const FALLBACK_NODES = [
  { host: "lava-v4.ajieblogs.eu.org", auth: "https://dsc.gg/ajidevserver" },
  { host: "lavalinkv4.serenetia.com", auth: "https://dsc.gg/ajidevserver" },
  { host: "lavalink.serenetia.com", auth: "https://dsc.gg/ajidevserver" },
];

// Un nœud configuré explicitement (typiquement le nœud privé du projet) est
// utilisé SEUL : Shoukaku se connecte à tous les nœuds déclarés dès le
// démarrage, donc garder les nœuds publics en secours reviendrait à les
// solliciter à chaque redéploiement — c'est précisément ce qui nous a fait
// bannir par leur limite de connexions ("Too many websocket connections
// attempt for this bot"). Les nœuds publics ne servent que si rien n'est
// configuré.
const LavalinkNodes = process.env.LAVALINK_HOST
  ? [
      {
        name: "prive",
        url: `${process.env.LAVALINK_HOST}:${process.env.LAVALINK_PORT || "443"}`,
        auth: process.env.LAVALINK_PASSWORD || "youshallnotpass",
        secure: process.env.LAVALINK_SECURE ? process.env.LAVALINK_SECURE === "true" : true,
      },
    ]
  : FALLBACK_NODES.map((node, i) => ({
      name: `public-${i + 1}`,
      url: `${node.host}:443`,
      auth: node.auth,
      secure: true,
    }));

console.log(`[lavalink] ${LavalinkNodes.length} nœud(s) déclaré(s) : ${LavalinkNodes.map((n) => n.url).join(", ")}`);

client.kazagumo = new Kazagumo(
  {
    defaultSearchEngine: "youtube",
    send: (guildId, payload) => {
      const guild = client.guilds.cache.get(guildId);
      if (guild) guild.shard.send(payload);
    },
  },
  new Connectors.DiscordJS(client),
  LavalinkNodes,
  // Les nœuds publics ont des coupures passagères, donc on retente longtemps
  // (la valeur par défaut de Shoukaku, 3 tentatives, abandonne trop vite).
  // Mais PAS toutes les 5 secondes : multiplié par le nombre de nœuds, ça
  // nous a fait bannir temporairement en HTTP 429 par les trois à la fois.
  // 20s d'intervalle reste réactif tout en restant supportable pour des
  // serveurs gratuits, et 200 tentatives couvrent plus d'une heure de panne.
  { reconnectTries: 200, reconnectInterval: 20 }
);

client.kazagumo.shoukaku.on("ready", (name) => console.log(`✅ Nœud Lavalink "${name}" connecté.`));
client.kazagumo.shoukaku.on("error", (name, error) =>
  console.error(`❌ Erreur du nœud Lavalink "${name}":`, error)
);
client.kazagumo.shoukaku.on("close", (name, code, reason) =>
  console.warn(`⚠️ Nœud Lavalink "${name}" fermé (code ${code}): ${reason}`)
);
client.kazagumo.shoukaku.on("disconnect", (name) =>
  console.warn(`⚠️ Nœud Lavalink "${name}" déconnecté.`)
);

// Stocke le dernier message "panel" par serveur pour pouvoir l'éditer
client.nowPlayingMessages = new Collection();

// Stocke l'intervalle de rafraîchissement du panel (position en direct) par serveur
client.nowPlayingIntervals = new Collection();

// Stocke qui chaque serveur suit actuellement via !join/spotify_join (voir
// utils/joinSpotify.js) : Map<guildId, { targetUserId, lastSyncId }>
client.spotifyFollows = new Collection();

// Stocke qui a amené le bot en vocal sur chaque serveur (Map<guildId, userId>)
// et qui d'autre a été autorisé entretemps (Map<guildId, Set<userId>>) — voir
// utils/playerControl.js. Seul le "propriétaire" (ou une personne autorisée
// par lui) peut utiliser les commandes de contrôle (pause/skip/stop/volume/
// loop/leave) ; les autres doivent lui demander la permission.
client.playerOwners = new Collection();
client.playerAllowed = new Collection();

// Dernier message supprimé par salon, pour &snipe. Volontairement en mémoire
// seulement : l'information est éphémère par nature et n'a aucune raison de
// survivre à un redémarrage.
client.snipes = new Collection();

// ---- Événements Kazagumo ----
client.kazagumo
  .on("playerStart", async (player) => {
    const textChannel = client.channels.cache.get(player.textId);
    if (!textChannel) return;

    // Si ce serveur suit quelqu'un via !join, la position a déjà été envoyée
    // dans l'appel de lecture (player.play(track, { position })) — on relit
    // juste la présence ici pour afficher la bonne valeur dans le panel,
    // aucun aller-retour réseau supplémentaire n'est nécessaire.
    let elapsedMs = 0;
    const follow = client.spotifyFollows.get(player.guildId);
    if (follow) {
      const guild = client.guilds.cache.get(player.guildId);
      const listenerMember = guild?.members.cache.get(follow.targetUserId);
      const activity = listenerMember ? getSpotifyActivity(listenerMember) : null;
      if (activity) {
        follow.lastSyncId = activity.syncId;
        elapsedMs = spotifyActivityElapsedMs(activity);
      }
    }

    const panel = buildNowPlayingPanel(player, elapsedMs);
    const msg = await textChannel.send(panel);
    client.nowPlayingMessages.set(player.guildId, msg);
    startNowPlayingTracking(client, player, elapsedMs);
  })
  .on("playerEmpty", (player) => {
    const textChannel = client.channels.cache.get(player.textId);
    stopNowPlayingTracking(client, player.guildId);
    if (textChannel) {
      textChannel.send({
        embeds: [buildStatusEmbed("info", "File d'attente terminée.")],
      });
    }
  })
  .on("playerException", (player, error) => {
    console.error(error);
    const textChannel = client.channels.cache.get(player.textId);
    if (textChannel) {
      textChannel.send({
        embeds: [buildStatusEmbed("error", String(error?.message ?? error).slice(0, 1800))],
      });
    }
  });

const MUSIC_BUTTON_IDS = new Set(["music_pauseresume", "music_skip", "music_stop", "music_loop", "music_queue"]);
// "music_queue" est en lecture seule, pas besoin de la permission de contrôle.
const GATED_MUSIC_BUTTONS = new Set(["music_pauseresume", "music_skip", "music_stop", "music_loop"]);

// ---- Interactions : slash commands + boutons du panel ----
client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      console.error(err);
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      const payload = {
        embeds: [buildStatusEmbed("error", "Erreur lors de l'exécution de la commande.")],
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    }
    return;
  }

  // Panneau de configuration : boutons, menus ET modales passent tous par là
  // (voir utils/configPanel.js). Placé avant le reste car il couvre plusieurs
  // types d'interaction d'un coup ; les commandes slash n'ont pas de customId
  // et ne sont donc pas concernées.
  if (interaction.customId?.startsWith("cfg:")) {
    await handleConfigInteraction(interaction).catch((err) => console.error("[configPanel]", err));
    return;
  }

  // Navigation dans l'aide : la réponse est recalculée pour QUI CLIQUE et
  // envoyée en éphémère, deux membres de rangs différents ne voyant pas la
  // même liste de commandes.
  if (interaction.isStringSelectMenu?.() && interaction.customId === HELP_SELECT_ID) {
    const panel = buildHelpPanel(interaction.guild.id, interaction.user.id, interaction.values[0]);
    return interaction
      .reply({ ...panel, flags: panel.flags | MessageFlags.Ephemeral })
      .catch(() => {});
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("spotify_join:")) {
      const targetId = interaction.customId.split(":")[1];
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) {
        return interaction.reply({
          embeds: [buildStatusEmbed("error", "Tu dois être dans un salon vocal.")],
          ephemeral: true,
        });
      }
      const listenerMember = interaction.guild.members.cache.get(targetId);
      if (!listenerMember) {
        return interaction.reply({
          embeds: [buildStatusEmbed("error", "Membre introuvable.")],
          ephemeral: true,
        });
      }
      await interaction.deferReply({ ephemeral: true });
      await handleJoinSpotify({
        client,
        voiceChannel,
        textChannel: interaction.channel,
        listenerMember,
        playerMember: interaction.member,
        send: (payload) => interaction.editReply(payload),
      });
      return;
    }

    // Favoris : actions PERSONNELLES, traitées avant les contrôles de salon
    // vocal et de propriétaire du player — mettre un titre de côté ou relire
    // sa propre liste ne dépend pas de qui pilote la lecture.
    if (interaction.customId === "music_fav") {
      const current = client.kazagumo.players.get(interaction.guildId)?.queue.current;
      if (!current) {
        return interaction.reply({
          embeds: [buildStatusEmbed("error", "Aucune musique en cours.")],
          ephemeral: true,
        });
      }
      const outcome = favoritesStore.toggle(interaction.user.id, current);
      const text = outcome.full
        ? `Ta liste est pleine (${favoritesStore.MAX_FAVORITES} titres). Retire-en un avant d'en ajouter.`
        : outcome.added
        ? `**${current.title}** ajouté à tes favoris.`
        : `**${current.title}** retiré de tes favoris.`;
      return interaction.reply({
        embeds: [buildStatusEmbed(outcome.full ? "error" : "success", text)],
        ephemeral: true,
      });
    }

    if (interaction.customId === "music_favlist") {
      const { main } = getPrefixes(interaction.guildId);
      const panel = buildFavoritesPanel(interaction.user.id, main);
      if (!panel) {
        return interaction.reply({
          embeds: [buildStatusEmbed("error", "Tu n'as encore aucun favori.")],
          ephemeral: true,
        });
      }
      return interaction.reply({ ...panel, flags: panel.flags | MessageFlags.Ephemeral });
    }

    if (!MUSIC_BUTTON_IDS.has(interaction.customId)) return;

    const player = client.kazagumo.players.get(interaction.guildId);
    if (!player) {
      return interaction.reply({
        embeds: [buildStatusEmbed("error", "Aucune musique en cours.")],
        ephemeral: true,
      });
    }

    const memberVoiceChannel = interaction.member.voice.channel;
    if (!memberVoiceChannel || memberVoiceChannel.id !== player.voiceId) {
      return interaction.reply({
        embeds: [buildStatusEmbed("error", "Tu dois être dans le même salon vocal que le bot.")],
        ephemeral: true,
      });
    }

    if (GATED_MUSIC_BUTTONS.has(interaction.customId) && !canControlPlayer(client, interaction.guildId, interaction.user.id)) {
      requestPlayerAccess(client, interaction.channel, interaction.user, interaction.guildId);
      return interaction.reply({
        embeds: [
          buildStatusEmbed(
            "info",
            "Cette commande est réservée à la personne qui a lancé la musique. Une demande d'autorisation lui a été envoyée."
          ),
        ],
        ephemeral: true,
      });
    }

    switch (interaction.customId) {
      case "music_pauseresume":
        setPlayerPaused(player, !player.paused);
        break;
      case "music_skip":
        if (!player.queue.current) {
          return interaction.reply({
            embeds: [buildStatusEmbed("error", "Rien à passer.")],
            ephemeral: true,
          });
        }
        player.skip();
        break;
      case "music_stop":
        stopNowPlayingTracking(client, interaction.guildId);
        clearPlayerControl(client, interaction.guildId);
        player.destroy();
        break;
      case "music_loop": {
        const order = ["none", "track", "queue"];
        const next = order[(order.indexOf(player.loop) + 1) % order.length];
        player.setLoop(next);
        break;
      }
      case "music_queue": {
        const tracks = [player.queue.current, ...player.queue].filter(Boolean);
        const list = tracks
          .slice(0, 10)
          .map((t, i) => `${i === 0 ? "En cours :" : `${i}.`} ${t.title}`)
          .join("\n");
        return interaction.reply({
          embeds: [buildStatusEmbed("info", list || "Vide.", { title: "File d'attente" })],
          ephemeral: true,
        });
      }
    }

    // Met à jour le panel après action (sauf stop, qui détruit le player)
    const updatedPlayer = client.kazagumo.players.get(interaction.guildId);
    if (interaction.customId !== "music_stop" && updatedPlayer) {
      const panel = buildNowPlayingPanel(updatedPlayer, getElapsedMs(interaction.guildId));
      await interaction.update(panel);
    } else {
      await interaction.update(buildStoppedPanel());
    }
    return;
  }

  // Choix d'un favori dans la playlist (voir utils/favoritesPanel.js).
  if (interaction.isStringSelectMenu?.() && interaction.customId === FAV_SELECT_ID) {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [buildStatusEmbed("error", "Tu dois être dans un salon vocal.")],
        ephemeral: true,
      });
    }

    // La liste est relue au clic : le favori a pu être retiré entre-temps.
    const favorite = favoritesStore.list(interaction.user.id)[Number(interaction.values[0])];
    if (!favorite) {
      return interaction.reply({
        embeds: [buildStatusEmbed("error", "Ce favori n'existe plus.")],
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const outcome = await queueAndPlay(client.kazagumo, {
        voiceChannel,
        textChannel: interaction.channel,
        member: interaction.member,
        query: favorite.uri,
        client,
      });
      if (!outcome) {
        return interaction.editReply({
          embeds: [buildStatusEmbed("error", `Impossible de jouer **${favorite.title}**.`)],
        });
      }
      const label = outcome.alreadyPlaying ? "Ajouté à la file d'attente" : "Lancement de";
      await interaction.editReply({
        embeds: [buildStatusEmbed("info", `${label} : **${outcome.result.tracks[0].title}**`)],
      });
    } catch (err) {
      console.error(err);
      await interaction.editReply({
        embeds: [buildStatusEmbed("error", playbackErrorMessage(err, `Impossible de jouer **${favorite.title}**.`))],
      });
    }
  }
});

// ---- Commandes textuelles préfixées ----
client.on("messageCreate", (message) => {
  handleMusicTextCommand(client, message).catch((err) => {
    console.error(err);
    message
      .reply({ embeds: [buildStatusEmbed("error", "Une erreur est survenue lors du traitement de la commande.")] })
      .catch(() => {});
  });
  // Déclencheurs "uo clear"/"anas clear"/"yanis clear" — pas de préfixe,
  // ouvert à tout le monde (rate-limité), voir utils/selfClear.js.
  handleSelfClear(client, message).catch((err) => console.error(err));
});

// ---- Mémorise le dernier message supprimé de chaque salon (voir &snipe) ----
client.on("messageDelete", (message) => {
  if (!message.guild || message.author?.bot) return;
  client.snipes.set(message.channel.id, {
    content: message.content || "*(pas de contenu texte)*",
    authorTag: message.author?.tag || "Inconnu",
    authorAvatar: message.author?.displayAvatarURL?.() || null,
    deletedAt: Date.now(),
  });
});

// ---- Déconnecte le bot si tout le monde quitte le salon vocal, et nettoie
// l'état si le bot lui-même est déconnecté/expulsé/déplacé (manuellement
// depuis Discord, kick, coupure...) ----
client.on("voiceStateUpdate", (oldState, newState) => {
  const player = client.kazagumo.players.get(oldState.guild.id);
  if (!player || oldState.channelId !== player.voiceId) return;

  const textChannel = client.channels.cache.get(player.textId);

  // Le bot a quitté le salon suivi par le player sans passer par nos propres
  // commandes (déconnexion manuelle, kick, déplacement...) : le player
  // Kazagumo ne reflète plus la réalité vocale. Sans ce nettoyage, il reste
  // en mémoire et le prochain `!play`/`/play` le réutilise tel quel (file,
  // position, propriétaire fantômes) au lieu de repartir de zéro.
  if (oldState.id === client.user.id) {
    stopNowPlayingTracking(client, player.guildId);
    clearPlayerControl(client, player.guildId);
    player.destroy().catch(() => {});
    if (textChannel) {
      textChannel.send({
        embeds: [buildStatusEmbed("info", "Je ne suis plus dans le salon vocal, la lecture s'est arrêtée.")],
      });
    }
    return;
  }

  const voiceChannel = oldState.guild.channels.cache.get(player.voiceId);
  if (!voiceChannel) return;

  const humanCount = voiceChannel.members.filter((m) => !m.user.bot).size;
  if (humanCount === 0) {
    stopNowPlayingTracking(client, player.guildId);
    clearPlayerControl(client, player.guildId);
    player.destroy().catch(() => {});
    if (textChannel) {
      textChannel.send({
        embeds: [buildStatusEmbed("info", "Tout le monde a quitté le salon vocal, je me déconnecte.")],
      });
    }
  }
});

// ---- Suit en direct les changements de morceau Spotify de la personne suivie
// via !join/spotify_join, et bascule la lecture instantanément dessus ----
client.on("presenceUpdate", async (oldPresence, newPresence) => {
  const guild = newPresence?.guild;
  if (!guild) return;

  const follow = client.spotifyFollows.get(guild.id);
  if (!follow || follow.targetUserId !== newPresence.userId) return;

  const player = client.kazagumo.players.get(guild.id);
  if (!player) {
    client.spotifyFollows.delete(guild.id);
    return;
  }

  const activity = findSpotifyActivity(newPresence.activities);
  if (!activity || activity.syncId === follow.lastSyncId) return;
  follow.lastSyncId = activity.syncId;

  try {
    const member = newPresence.member ?? guild.members.cache.get(newPresence.userId);
    const result = await client.kazagumo.search(spotifyActivityQuery(activity), {
      requester: member,
      engine: "youtube",
    });
    if (!result || !result.tracks.length) return;
    // Position envoyée directement dans l'appel de lecture (recalculée juste
    // avant, au cas où la recherche ci-dessus ait pris du temps) : Lavalink
    // démarre la piste déjà à la bonne seconde en un seul aller-retour réseau.
    const freshActivity = findSpotifyActivity(member?.presence?.activities) ?? activity;
    await player.play(result.tracks[0], {
      replaceCurrent: true,
      position: spotifyActivityElapsedMs(freshActivity),
    });
  } catch (err) {
    console.error(err);
  }
});

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    // Sur un serveur avec beaucoup de membres, Discord ne pousse pas forcément
    // les présences de tout le monde par défaut (limite du "large_threshold").
    // On demande explicitement la liste complète des membres + présences pour
    // que la présence Spotify de n'importe qui soit fiable dès le premier
    // !join, pas seulement pour les membres déjà "connus" du bot.
    guild.members.fetch({ withPresences: true }).catch((err) => {
      console.warn(`⚠️ Impossible de récupérer les présences du serveur "${guild.name}":`, err.message);
    });

    // Restaure les préfixes configurés : le disque du container Railway est
    // réinitialisé à chaque redéploiement, donc sans ça ils reviendraient à
    // leur valeur par défaut à chaque push (voir utils/configChannel.js, qui
    // sauvegarde tout ça dans un salon Discord caché).
    loadGuildConfig(guild).catch((err) => {
      console.warn(`⚠️ Impossible de restaurer la config du serveur "${guild.name}":`, err.message);
    });
  }
});

// Fait la même chose quand le bot rejoint un nouveau serveur en cours de route.
client.on("guildCreate", (guild) => {
  guild.members.fetch({ withPresences: true }).catch((err) => {
    console.warn(`⚠️ Impossible de récupérer les présences du serveur "${guild.name}":`, err.message);
  });
  loadGuildConfig(guild).catch((err) => {
    console.warn(`⚠️ Impossible de restaurer la config du serveur "${guild.name}":`, err.message);
  });
});

// Sans handler, Node.js termine le process instantanément sur SIGTERM (le
// signal que Railway envoie pour arrêter l'ancien conteneur à chaque
// redéploiement) — on laisse une courte marge pour fermer proprement la
// connexion Lavalink/Discord plutôt que de couper en plein milieu.
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] Signal ${signal} reçu, arrêt dans 3s...`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  client.destroy();
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

client.login(process.env.DISCORD_TOKEN);
