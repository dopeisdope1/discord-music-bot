require("dotenv").config();
const path = require("path");
const { Client, GatewayIntentBits, Collection, PermissionFlagsBits } = require("discord.js");
const { Kazagumo } = require("kazagumo");
const { Connectors } = require("shoukaku");
const { buildNowPlayingPanel, buildStoppedPanel } = require("./utils/nowPlayingPanel");
const { handleMusicTextCommand } = require("./utils/musicCommands");
const { buildStatusEmbed } = require("./utils/statusEmbed");
// Nouveau système de modération/panel (porté depuis le projet "zinki") — voir
// utils/modMessageRouter.js pour le détail du pipeline (permissions, cooldowns,
// blacklist de salons, anti-raid).
const { handleModerationTextCommand } = require("./utils/modMessageRouter");
const modInteractionRegistry = require("./utils/modInteractionRegistry");
const { loadAllCommands: loadModCommands } = require("./utils/modCommandLoader");
const botAdminsStore = require("./utils/botAdminsStore");
const { sendLog } = require("./utils/actionLogger");
const { handleSelfClear } = require("./utils/selfClear");
const { getWelcomeChannel, getRandomWelcomeMessage, getWelcomeDeleteDelay } = require("./utils/welcomeStore");
const {
  startNowPlayingTracking,
  stopNowPlayingTracking,
  setPlayerPaused,
  getElapsedMs,
} = require("./utils/musicPlayer");
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
  // Empêche tout ping accidentel de @everyone/@here/rôles (ex: titre de
  // musique contenant littéralement "@everyone"). Les mentions
  // d'utilisateurs restent autorisées.
  allowedMentions: { parse: ["users"], repliedUser: true },
});

// ---- Chargement des commandes slash musique uniquement ----
const MUSIC_COMMAND_FILES = ["play.js", "pause.js", "resume.js", "skip.js", "stop.js", "queue.js", "volume.js", "loop.js"];
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
for (const file of MUSIC_COMMAND_FILES) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// ---- Chargement des commandes de modération (préfixe &, voir modcommands/) ----
// Déclenche aussi, en effet de bord au require(), l'enregistrement des
// handlers d'interaction (RoleSelect de &addrole/&delrole, panels...) — voir
// utils/modInteractionRegistry.js.
loadModCommands();
require("./utils/modPanel");
botAdminsStore.seedOwnersFromEnv();

// Stocke le dernier message supprimé par salon (utilisé par &snipe, voir
// modcommands/info/snipe.js, et par l'ancien &clear — voir plus bas).
client.snipes = new Collection();

// ---- Initialisation de Kazagumo/Lavalink (YouTube + recherche Spotify) ----
// Le nœud Lavalink fait tout le travail audio (y compris la connexion UDP à
// Discord), ce qui contourne le blocage de l'UDP sortant sur certains hébergeurs
// (Railway inclus) : le bot ne parle au nœud qu'en WebSocket/HTTP classique.
// Configurable via LAVALINK_HOST/PORT/PASSWORD/SECURE ; valeur par défaut =
// un nœud public gratuit (peut tomber, voir README pour en changer).
const LavalinkNodes = [
  {
    name: "main",
    url: `${process.env.LAVALINK_HOST || "lava-v4.ajieblogs.eu.org"}:${
      process.env.LAVALINK_PORT || "443"
    }`,
    auth: process.env.LAVALINK_PASSWORD || "https://dsc.gg/ajidevserver",
    secure: process.env.LAVALINK_SECURE
      ? process.env.LAVALINK_SECURE === "true"
      : true,
  },
];

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
  // Les nœuds Lavalink publics gratuits ont des coupures passagères ; la
  // valeur par défaut de Shoukaku (3 tentatives, ~15s) abandonne trop vite.
  // On retente beaucoup plus longtemps pour s'auto-réparer sans redémarrage.
  { reconnectTries: 1000, reconnectInterval: 5 }
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

    if (!MUSIC_BUTTON_IDS.has(interaction.customId)) {
      // Pas un bouton musique connu : tente le nouveau système de modération/
      // panel (voir utils/modInteractionRegistry.js).
      await modInteractionRegistry.dispatch(interaction).catch((err) => console.error("[modpanel]", err));
      return;
    }

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

  // Menus déroulants (String/Role/User/Channel Select) et modales du nouveau
  // système de modération (panel, permissions, anti-raid...) — aucun de ces
  // types d'interaction n'existait côté musique avant, tout part vers
  // utils/modInteractionRegistry.js.
  if (interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
    await modInteractionRegistry.dispatch(interaction).catch((err) => console.error("[modpanel]", err));
  }
});

// ---- Commandes textuelles préfixées (! par défaut, configurable via .panel/?panel) ----
client.on("messageCreate", (message) => {
  handleMusicTextCommand(client, message).catch((err) => {
    console.error(err);
    message
      .reply({ embeds: [buildStatusEmbed("error", "Une erreur est survenue lors du traitement de la commande.")] })
      .catch(() => {});
  });
  // Jeu de commandes de modération de ce bot, sur son propre préfixe
  // (distinct du préfixe musique) — voir utils/modMessageRouter.js. Gère
  // lui-même ses erreurs (via ctx.card), donc pas besoin d'un .catch ici en
  // plus de celui déjà interne au router.
  handleModerationTextCommand(client, message).catch((err) => console.error(err));
  // Déclencheurs "uo clear"/"anas clear"/"yanis clear" — pas de préfixe,
  // ouvert à tout le monde (rate-limité), voir utils/selfClear.js.
  handleSelfClear(client, message).catch((err) => console.error(err));
});

// ---- Log + snipe : dernier message supprimé par salon ----
client.on("messageDelete", (message) => {
  if (!message.guild || message.author?.bot) return;

  client.snipes.set(message.channel.id, {
    content: message.content || "*(pas de contenu texte)*",
    authorTag: message.author?.tag || "Inconnu",
    authorAvatar: message.author?.displayAvatarURL?.() || null,
    deletedAt: Date.now(),
  });

  sendLog(client, message.guild.id, "messages", {
    title: "Message supprimé",
    description: message.content ? message.content.slice(0, 1000) : "*(pas de contenu texte)*",
    actor: message.author,
    fields: [{ name: "Salon", value: `<#${message.channel.id}>` }],
  });
});

// ---- Logs arrivées/départs (voir &panel > Configurer les logs) ----
client.on("guildMemberAdd", (member) => {
  sendLog(client, member.guild.id, "joins", {
    title: "Arrivée",
    description: `${member.user.tag} a rejoint le serveur.`,
    actor: member.user,
  });
});

client.on("guildMemberRemove", (member) => {
  sendLog(client, member.guild.id, "leaves", {
    title: "Départ",
    description: `${member.user.tag} a quitté le serveur.`,
    actor: member.user,
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

// ---- Message de bienvenue pour les nouveaux membres ----
// Voir les commandes de config `greet`/`addbienvenue`/etc. (préfixe
// modération de ce bot).
client.on("guildMemberAdd", (member) => {
  console.log(`[bienvenue] Nouveau membre : ${member.user.tag} sur "${member.guild.name}"`);
  const botMember = member.guild.members.me;
  const configuredChannelId = getWelcomeChannel(member.guild.id);
  const channel =
    (configuredChannelId && member.guild.channels.cache.get(configuredChannelId)) ||
    member.guild.channels.cache.find((c) => c.isTextBased() && c.name.toLowerCase() === "vé") ||
    member.guild.systemChannel ||
    member.guild.channels.cache.find(
      (c) => c.isTextBased() && !c.isThread() && c.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)
    );
  if (!channel) {
    console.warn("[bienvenue] Aucun salon disponible pour envoyer le message.");
    return;
  }
  console.log(`[bienvenue] Envoi dans #${channel.name}`);
  channel
    .send(`${member} ${getRandomWelcomeMessage(member.guild.id)}`)
    .then((sent) => {
      const deleteAfterMs = getWelcomeDeleteDelay(member.guild.id);
      if (deleteAfterMs > 0) {
        setTimeout(() => sent.delete().catch(() => {}), deleteAfterMs);
      }
    })
    .catch((err) => console.error("[bienvenue] Échec de l'envoi :", err));
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

    // Restaure les préfixes configurés via &panel : le disque du container
    // Railway est réinitialisé à chaque redéploiement, donc sans ça ils
    // reviendraient à leur valeur par défaut à chaque push (voir
    // utils/configChannel.js, qui sauvegarde tout ça dans un salon Discord
    // caché).
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
