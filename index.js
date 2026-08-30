require("dotenv").config();
const path = require("path");
const { Client, GatewayIntentBits, Collection, MessageFlags, ChannelType } = require("discord.js");
const { Kazagumo } = require("kazagumo");
const { Connectors, Constants: ShoukakuConstants } = require("shoukaku");
const ShoukakuState = ShoukakuConstants.State;
const { buildNowPlayingPanel, buildStoppedPanel } = require("./utils/nowPlayingPanel");
const { handleMusicTextCommand } = require("./utils/musicCommands");
const { buildStatusEmbed } = require("./utils/statusEmbed");
// Déclencheurs sans préfixe "uo clear" & consorts, distincts de &clear (voir
// utils/selfClear.js et utils/moderationCommands.js) : celui-ci n'efface que
// les messages de son propre auteur, sans permission requise.
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
const { handleBanInteraction } = require("./utils/banPanel");
const { handleBanAllInteraction } = require("./utils/banAll");
const { checkMessage: checkAntiSpam } = require("./utils/automod/antiSpam");
const { checkMessage: checkAntiLink } = require("./utils/automod/antiLink");
const { checkMessage: checkAntiMention } = require("./utils/automod/antiMention");
const { checkMessage: checkBadWords } = require("./utils/automod/badWords");
const { revokeIfGone } = require("./utils/permissions/cleanup");
const { handleServerAdminInteraction, handleConfirmInteraction, applyDeroToNewChannel } = require("./utils/serverAdminCommands");
const welcomeStore = require("./utils/welcomeStore");
const voiceChannels = require("./utils/voiceChannels");
const { handleTicketButton } = require("./utils/tickets");
const { handlePollButton } = require("./utils/polls");
const { handleGiveawayButton, checkExpiredGiveaways } = require("./utils/giveaways");
const { applyPresence } = require("./utils/botProfileCommands");
const { checkExpiredMutes, checkExpiredTempbans } = require("./utils/moderationExtra");
const { checkExpiredTempRoles, applyAutoReact, handleEmbedButton, handleEmbedModal } = require("./utils/serverExtra");
const { buildHelpPanel, SELECT_ID: HELP_SELECT_ID } = require("./utils/helpPanel");
const { playbackErrorMessage } = require("./utils/musicErrors");
const { handleJoinSpotify } = require("./utils/joinSpotify");
const { findSpotifyActivity, getSpotifyActivity, spotifyActivityQuery, spotifyActivityElapsedMs } = require("./utils/spotifyPresence");
const { canControlPlayer, requestPlayerAccess, clearPlayerControl } = require("./utils/playerControl");
const { SEARCH_ENGINE } = require("./utils/searchEngine");
const { createDeadTrackRecovery, playbackFailureMessage, noteManualSkip } = require("./utils/deadTrack");
const { relayAuditLogEntry, logMessageDelete } = require("./utils/moderationLog");
const { checkAuditEntry, checkEveryoneMention, checkJoinFlood } = require("./utils/guard/definitions");

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
    // Nécessaire à guildAuditLogEntryCreate (voir plus bas) : sans lui, le
    // salon de logs configuré via &panel ne reçoit jamais rien. Non
    // privilégié, aucune activation manuelle requise sur le portail.
    GatewayIntentBits.GuildModeration,
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
    // SoundCloud et non YouTube : depuis un hébergeur comme Railway, YouTube
    // répond "Sign in to confirm you're not a bot" à tous les clients et
    // aucune lecture n'aboutit. SoundCloud n'impose pas cette vérification.
    // La valeur vient de utils/searchEngine.js, seule source du projet : la
    // réécrire en dur ici rendait MUSIC_SEARCH_ENGINE sans effet sur les
    // recherches qui ne précisent pas de moteur.
    defaultSearchEngine: SEARCH_ENGINE,
    send: (guildId, payload) => {
      const guild = client.guilds.cache.get(guildId);
      if (guild) guild.shard.send(payload);
    },
  },
  new Connectors.DiscordJS(client),
  LavalinkNodes,
  {
    // Reprise de la lecture après une coupure du nœud. Se reconnecter ne
    // suffisait pas : le bot retrouvait bien le nœud, mais plus rien ne jouait
    // tant que personne ne relançait le morceau à la main.
    //   - resume : si c'est notre WebSocket qui saute, Lavalink garde nos
    //     lecteurs en vie pendant resumeTimeout et la musique ne s'interrompt
    //     même pas.
    //   - resumeByLibrary : si c'est le NŒUD qui est mort, sa session est
    //     perdue avec lui. Le bot recrée alors les lecteurs et relance chaque
    //     piste là où elle en était.
    resume: true,
    resumeTimeout: 30,
    resumeByLibrary: true,
    // Le rythme de reconnexion dépend du type de nœud :
    //   - nœud privé : il est à nous, personne à ménager. On retente vite et
    //     sans plafond réaliste, sinon une simple maintenance du nœud suffit à
    //     épuiser les tentatives et la musique reste morte jusqu'au prochain
    //     redémarrage du bot — c'est exactement ce qui est arrivé.
    //   - nœuds publics : espacer, sous peine de se faire bannir en 429.
    ...(process.env.LAVALINK_HOST
      ? { reconnectTries: 100000, reconnectInterval: 5 }
      : { reconnectTries: 200, reconnectInterval: 20 }),
  }
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

// Filet de sécurité : Shoukaku cesse définitivement de retenter dans deux cas
// vécus en production — quand il épuise reconnectTries, et quand le nœud est
// injoignable au tout premier essai (bot démarré avant Lavalink). Le bot
// restait alors muet jusqu'à un redémarrage manuel, alors que le nœud était
// revenu. On revérifie donc périodiquement, et on relance la connexion nous-
// mêmes tant qu'aucun nœud n'est branché.
const NODE_WATCHDOG_MS = 30_000;

/**
 * `shoukaku.nodes` est une Map dans les versions récentes, mais l'a déjà été
 * sous d'autres formes : on accepte Map comme tableau, sinon la boucle reste
 * vide sans rien dire — c'est ce qui a rendu une première version de ce
 * garde-fou totalement inopérante, et silencieuse avec.
 */
function listNodes() {
  const raw = client.kazagumo.shoukaku?.nodes;
  if (!raw) return [];
  if (typeof raw.values === "function") return [...raw.values()];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw);
}

setInterval(() => {
  const nodes = listNodes();

  if (!nodes.length) {
    console.warn("[lavalink] garde-fou : aucun nœud visible, rien à surveiller.");
    return;
  }

  const offline = nodes.filter((n) => n.state !== ShoukakuState.CONNECTED);
  if (!offline.length) return;

  for (const node of offline) {
    console.warn(`[lavalink] nœud "${node.name}" hors ligne (état ${node.state}), tentative de reconnexion.`);
    // connect() est asynchrone : son échec ressort en promesse rejetée, que le
    // try/catch synchrone d'origine ne voyait pas. Une promesse rejetée sans
    // preneur arrête net le process sous Node — une tentative de reconnexion
    // ratée suffisait donc à faire tomber tout le bot.
    Promise.resolve(node.connect()).catch((err) =>
      console.error(`[lavalink] échec de la tentative sur "${node.name}" :`, err.message)
    );
  }
}, NODE_WATCHDOG_MS);

console.log(`[lavalink] garde-fou armé, vérification toutes les ${NODE_WATCHDOG_MS / 1000}s.`);

// Vérifie périodiquement les giveaways arrivés à échéance (voir
// utils/giveaways.js) — persistés (utils/giveawayStore.js), donc un
// redéploiement pendant qu'un giveaway est en cours ne le fait pas
// disparaître, juste reprendre la vérification au redémarrage.
setInterval(() => {
  checkExpiredGiveaways(client).catch((err) => console.error("[giveaways]", err));
}, 30_000);

// Lève les mutes/bans temporaires arrivés à échéance (&tempmute/&tempban,
// voir utils/moderationExtra.js) — même fréquence que les giveaways.
setInterval(() => {
  checkExpiredMutes(client).catch((err) => console.error("[mute]", err));
  checkExpiredTempbans(client).catch((err) => console.error("[tempban]", err));
  checkExpiredTempRoles(client).catch((err) => console.error("[temprole]", err));
}, 30_000);

// Fait tourner les activités configurées (&playto/&listen/&watch/&compet/
// &stream, voir utils/botProfileCommands.js) si plusieurs phrases ont été
// réglées — sans effet si une seule (ou aucune) n'est configurée.
setInterval(() => {
  try {
    applyPresence(client);
  } catch (err) {
    console.error("[botProfile]", err);
  }
}, 15_000);

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

// Délai laissé à Kazagumo pour enchaîner tout seul avant qu'on s'en mêle.
const DEAD_TRACK_GRACE_MS = 2_500;

// Reprise des morceaux qui refusent de se lire — voir utils/deadTrack.js.
const { handleDeadTrack, closeNowPlayingPanel } = createDeadTrackRecovery(client);

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

    // L'envoi du panel peut échouer (permissions retirées sur le salon, salon
    // supprimé, limite de débit) : sans ce filet, l'erreur ressortait en
    // promesse rejetée hors de toute pile d'appel et arrêtait le process, donc
    // la musique, pour un simple message non envoyé. Le suivi de lecture, lui,
    // doit démarrer dans tous les cas.
    let msg = null;
    try {
      msg = await textChannel.send(buildNowPlayingPanel(player, elapsedMs));
    } catch (err) {
      console.error("[musique] panel non envoyé :", err.message);
    }

    if (msg) client.nowPlayingMessages.set(player.guildId, msg);
    startNowPlayingTracking(client, player, elapsedMs);
  })
  .on("playerStuck", (player) => {
    // Lavalink signale une piste bloquée (plus aucune donnée audio depuis
    // trackStuckThresholdMs). Kazagumo n'en fait rien : sans ce handler, le
    // lecteur restait muet sur cette piste indéfiniment, sans message et sans
    // passer à la suivante.
    const dead = player.queue.current;
    console.warn(`[musique] piste bloquée sur le serveur ${player.guildId}.`);
    handleDeadTrack(player, dead, `${dead?.title ? `**${dead.title}**` : "Ce morceau"} s'est bloqué en cours de lecture.`);
  })
  .on("playerEmpty", (player) => {
    const textChannel = client.channels.cache.get(player.textId);
    closeNowPlayingPanel(player.guildId);
    if (textChannel) {
      textChannel.send({
        embeds: [buildStatusEmbed("info", "File d'attente terminée.")],
      });
    }
  })
  .on("playerException", (player, error) => {
    // Lavalink range le détail dans `exception`, pas à la racine : sans ça,
    // le journal ne gardait qu'un inutile "[object Object]".
    console.error(`[musique] échec de lecture sur le serveur ${player.guildId} :`, error?.exception || error);

    const dead = player.queue.current;
    if (!dead) return;

    // Rien n'est annoncé tout de suite : Lavalink fait normalement suivre
    // l'échec d'un événement de fin, que Kazagumo traite de son côté. On
    // laisse donc passer ce court délai avant de décider — sinon on doublerait
    // son travail, en sautant un morceau qu'il vient déjà d'enchaîner.
    setTimeout(() => {
      if (client.kazagumo.players.get(player.guildId) !== player) return; // lecteur détruit entre-temps
      if (player.playing || player.paused) return; // quelque chose joue déjà, rien à réparer

      // Deux situations à reprendre : la file est restée bloquée sur la piste
      // morte, ou elle s'est vidée à cause d'elle — c'est le cas quand le
      // morceau demandé était le seul, et le lecteur se retrouve muet.
      const bloquee = player.queue.current === dead;
      const fileMorte = !player.queue.current && !player.queue.size;
      if (!bloquee && !fileMorte) return;

      handleDeadTrack(player, dead, playbackFailureMessage(dead, error));
    }, DEAD_TRACK_GRACE_MS);
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

  // Constructeur d'embed (&embed, voir utils/serverExtra.js) : bouton ouvre
  // la modale, la modale postée déclenche l'envoi.
  if (interaction.customId === "srvextra:embedopen") {
    await handleEmbedButton(interaction).catch((err) => console.error("[serverExtra]", err));
    return;
  }
  if (interaction.customId === "srvextra:embed") {
    await handleEmbedModal(interaction).catch((err) => console.error("[serverExtra]", err));
    return;
  }

  // Panneau de bannissement de "zinki assasini" (voir utils/banPanel.js).
  if (interaction.customId?.startsWith("ban:")) {
    await handleBanInteraction(interaction).catch((err) => console.error("[banPanel]", err));
    return;
  }

  // Ban de masse (voir utils/banAll.js). Aucune ambiguïté avec le bloc
  // ci-dessus : le deux-points fait partie du préfixe, donc "banall:" ne
  // commence pas par "ban:".
  if (interaction.customId?.startsWith("banall:")) {
    await handleBanAllInteraction(interaction).catch((err) => console.error("[banAll]", err));
    return;
  }

  // Administration serveur : listes paginées (owners/whitelist, "srv:page|
  // add|del:...") et confirmations d'actions sensibles (suppression de
  // rôle/salon, don d'Administrateur — "srv:confirm:go|no:...") — voir
  // utils/serverAdminCommands.js.
  if (interaction.customId?.startsWith("srv:")) {
    const isConfirm = interaction.customId.startsWith("srv:confirm:");
    const handler = isConfirm ? handleConfirmInteraction : handleServerAdminInteraction;
    await handler(interaction).catch((err) => console.error("[serverAdminCommands]", err));
    return;
  }

  // Communauté (voir utils/tickets.js, utils/polls.js, utils/giveaways.js).
  if (interaction.customId?.startsWith("ticket:")) {
    await handleTicketButton(interaction).catch((err) => console.error("[tickets]", err));
    return;
  }
  if (interaction.customId?.startsWith("poll:")) {
    await handlePollButton(interaction).catch((err) => console.error("[polls]", err));
    return;
  }
  if (interaction.customId?.startsWith("giveaway:")) {
    await handleGiveawayButton(interaction).catch((err) => console.error("[giveaways]", err));
    return;
  }

  // Navigation dans l'aide : la réponse est recalculée pour QUI CLIQUE et
  // envoyée en éphémère, deux membres de rangs différents ne voyant pas la
  // même liste de commandes.
  if (interaction.isStringSelectMenu?.() && interaction.customId === HELP_SELECT_ID) {
    const panel = buildHelpPanel(interaction.guild.id, interaction.member, interaction.values[0]);
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
        noteManualSkip(interaction.guildId);
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
      const play = (query, engine) =>
        queueAndPlay(client.kazagumo, {
          voiceChannel,
          textChannel: interaction.channel,
          member: interaction.member,
          query,
          engine,
          client,
        });

      // Un lien YouTube mémorisé avant la bascule est écarté d'emblée : sa
      // RECHERCHE aboutit (Lavalink retrouve les métadonnées), seule la
      // lecture échoue ensuite. Attendre l'échec ne servirait donc à rien,
      // il faut ne pas emprunter ce chemin du tout.
      const staleYoutube = SEARCH_ENGINE !== "youtube" && /(?:youtube\.com|youtu\.be)/i.test(favorite.uri || "");
      const search = [favorite.title, favorite.author].filter(Boolean).join(" ");

      let outcome = staleYoutube ? null : await play(favorite.uri).catch(() => null);
      if (!outcome) outcome = await play(search, SEARCH_ENGINE).catch(() => null);

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
  // Anti-spam léger, désactivé par défaut par serveur (voir &panel > Protection
  // et utils/automod/antiSpam.js) — ne fait rien tant que personne ne l'active.
  checkAntiSpam(client, message).catch((err) => console.error("[antiSpam]", err));
  // Anti-lien, anti-mass-mention, mots interdits — même famille d'automod
  // léger, désactivés par défaut par serveur (voir &panel > Protection).
  checkAntiLink(client, message).catch((err) => console.error("[antiLink]", err));
  checkAntiMention(client, message).catch((err) => console.error("[antiMention]", err));
  checkBadWords(client, message).catch((err) => console.error("[badWords]", err));
  // Anti-nuke : mention @everyone/@here non autorisée, désactivé par défaut
  // (voir utils/guard/definitions.js).
  checkEveryoneMention(client, message).catch((err) => console.error("[guard:antieveryone]", err));
  // Réactions automatiques par salon (&autoreact, voir utils/serverExtra.js).
  applyAutoReact(message).catch((err) => console.error("[autoreact]", err));
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
  // Salon de logs "Messages" (voir &panel > Logs et utils/moderationLog.js) :
  // uniquement si le message était encore en cache (partiel sinon, sans
  // auteur ni contenu exploitable — rien à journaliser dans ce cas).
  if (message.author) {
    logMessageDelete(client, message).catch((err) => console.error("[moderationLog]", err));
  }
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

// ---- Salons vocaux temporaires (&voicehub, &vc, voir utils/voiceChannels.js)
// — listener séparé du nettoyage du player musique ci-dessus, aucun rapport
// entre les deux. ----
client.on("voiceStateUpdate", async (oldState, newState) => {
  // Rejoint le salon générateur -> crée un salon personnel et y déplace le membre.
  const hubId = voiceChannels.getHub(newState.guild.id);
  if (hubId && newState.channelId === hubId && oldState.channelId !== hubId) {
    const hub = newState.channel;
    const created = await newState.guild.channels
      .create({
        name: `Salon de ${newState.member.displayName}`.slice(0, 100),
        type: ChannelType.GuildVoice,
        parent: hub?.parentId || null,
        reason: `Salon vocal temporaire pour ${newState.member.user.tag}`,
      })
      .catch((err) => {
        console.error("[voiceChannels] échec de création :", err.message);
        return null;
      });
    if (created) {
      voiceChannels.registerChannel(created.id, newState.guild.id, newState.member.id);
      await newState.member.voice.setChannel(created).catch(() => {});
    }
  }

  // Quitte un salon temporaire -> le supprime une fois vide.
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const info = voiceChannels.getChannelInfo(oldState.channelId);
    if (info && oldState.channel && oldState.channel.members.size === 0) {
      await oldState.channel.delete("Salon vocal temporaire vidé").catch(() => {});
      voiceChannels.unregisterChannel(oldState.channelId);
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
      engine: SEARCH_ENGINE,
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

  // Réapplique le statut/activité configuré (&online/&idle/&dnd/&invisible,
  // &playto/&listen/&watch/&compet/&stream) — Discord ne le garde pas d'un
  // redémarrage à l'autre, contrairement au reste de la config du bot.
  applyPresence(client);

  for (const guild of client.guilds.cache.values()) {
    // Sur un serveur avec beaucoup de membres, Discord ne pousse pas forcément
    // les présences de tout le monde par défaut (limite du "large_threshold").
    // On demande explicitement la liste complète des membres + présences pour
    // que la présence Spotify de n'importe qui soit fiable dès le premier
    // !join, pas seulement pour les membres déjà "connus" du bot.
    guild.members.fetch({ withPresences: true }).catch((err) => {
      console.warn(`⚠️ Impossible de récupérer les présences du serveur "${guild.name}":`, err.message);
    });

  }
});

// Fait la même chose quand le bot rejoint un nouveau serveur en cours de route.
client.on("guildCreate", (guild) => {
  guild.members.fetch({ withPresences: true }).catch((err) => {
    console.warn(`⚠️ Impossible de récupérer les présences du serveur "${guild.name}":`, err.message);
  });
});

// Nettoyage des accès obsolètes (section 2 du cahier des charges) : quand
// quelqu'un quitte, ses octrois individuels et ses portées globales (sys/
// banall/clear/salon) sont révoqués — SAUF s'il est encore membre d'un autre
// serveur partagé avec le bot (voir utils/permissions/cleanup.js). Les
// octrois PAR RÔLE n'ont rien à nettoyer : ils se recalculent tout seuls sur
// les rôles actuels si la personne revient. L'historique de modération
// n'est jamais touché ici.
client.on("guildMemberRemove", (member) => {
  const changes = revokeIfGone(client, member.guild.id, member.id);
  if (changes.length) {
    console.log(`[accès] ${member.user.tag} a quitté "${member.guild.name}" : ${changes.join(", ")}`);
  }
});

// Dero automatique (voir &dero, utils/serverAdminCommands.js) : applique les
// permissions configurées aux rôles concernés sur chaque nouveau salon créé,
// sans action manuelle. Ne fait rien si aucun rôle n'est configuré.
client.on("channelCreate", (channel) => {
  applyDeroToNewChannel(channel).catch((err) => console.error("[dero]", err));
});

// Message de bienvenue (voir &panel > Bienvenue, utils/welcomeStore.js) : un
// message est tiré au hasard parmi ceux configurés, "{user}" y est remplacé
// par une mention du nouvel arrivant. Ne fait rien tant qu'aucun salon ou
// aucun message n'est configuré.
client.on("guildMemberAdd", async (member) => {
  const config = welcomeStore.getConfig(member.guild.id);
  if (!config.channelId) return;
  const text = welcomeStore.pickRandomMessage(member.guild.id);
  if (!text) return;

  const channel = member.guild.channels.cache.get(config.channelId);
  if (!channel?.isTextBased()) return;

  // "{user}" place la mention où on veut dans le texte ; sans lui, la
  // mention est ajoutée automatiquement devant — un message de bienvenue
  // doit pinger l'arrivant par défaut, pas seulement si on connaît la syntaxe.
  const mention = `<@${member.id}>`;
  const content = text.includes("{user}") ? text.replace(/\{user\}/g, mention) : `${mention} ${text}`;

  const sent = await channel.send({ content, allowedMentions: { users: [member.id] } }).catch((err) => {
    console.error("[welcome] échec d'envoi :", err.message);
    return null;
  });
  if (sent && config.autoDeleteSeconds > 0) {
    setTimeout(() => sent.delete().catch(() => {}), config.autoDeleteSeconds * 1000);
  }
});

// Anti-nuke : afflux de joins, désactivé par défaut (voir utils/guard/
// definitions.js). Listener séparé du message de bienvenue ci-dessus,
// volontairement : ce dernier sort tôt si aucun salon n'est configuré, ce
// qui n'a aucun rapport avec l'activation de l'anti-nuke.
client.on("guildMemberAdd", (member) => {
  checkJoinFlood(client, member).catch((err) => console.error("[guard:antijoin]", err));
});

// Journal de modération (voir utils/moderationLog.js) : chaque entrée
// d'audit Discord — ban, kick, timeout, salon/rôle supprimé, etc. — est
// relayée vers le salon configuré via &panel > Logs, quel qu'en soit
// l'auteur : ce bot (&ban/&unban/&banall), le CrowBot du serveur, ou un
// modérateur humain. Ne fait rien si aucun salon n'est configuré.
client.on("guildAuditLogEntryCreate", (entry, guild) => {
  relayAuditLogEntry(client, guild, entry).catch((err) => {
    console.error("[moderationLog] échec du relais d'une entrée d'audit :", err);
  });
  // Anti-nuke (voir utils/guard/), désactivé par défaut — même entrée
  // d'audit, deux traitements distincts et indépendants : le relais ci-
  // dessus journalise l'action brute, le moteur de guard réagit si un
  // seuil est franchi. checkAuditEntry() ne fait rien pour un type
  // d'événement qu'aucun guard ne suit.
  checkAuditEntry(client, guild, entry).catch((err) => {
    console.error("[guard] échec du traitement d'une entrée d'audit :", err);
  });
});

// Dernier rempart. Sous Node, une promesse rejetée sans preneur arrête le
// process entier : une erreur réseau isolée sur une requête Discord, un salon
// devenu inaccessible, un aller-retour Lavalink en échec, et la musique
// s'arrêtait pour tout le monde. Ces incidents sont sans conséquence pour la
// lecture en cours — on les journalise et le bot continue de tourner.
// Ils restent visibles dans les logs, ce n'est pas une façon de les masquer.
process.on("unhandledRejection", (reason) => {
  console.error("[bot] promesse rejetée sans traitement :", reason?.stack || reason);
});
process.on("uncaughtException", (err) => {
  console.error("[bot] exception non rattrapée :", err?.stack || err);
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

  // Les lecteurs sont détruits explicitement. Depuis que la reprise est
  // activée, Lavalink garde en vie les lecteurs d'un client qui s'en va, le
  // temps qu'il revienne : sans ce nettoyage, un redéploiement laisserait le
  // nœud jouer tout seul dans le vide pendant resumeTimeout, et le morceau
  // relancé juste après par quelqu'un se serait superposé au fantôme.
  const players = [...client.kazagumo.players.values()];
  if (players.length) console.log(`[shutdown] ${players.length} lecteur(s) à fermer.`);
  await Promise.allSettled(players.map((player) => player.destroy()));

  await new Promise((resolve) => setTimeout(resolve, 3000));
  client.destroy();
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// La connexion à Discord, elle, reste fatale : un bot qui n'a pas pu se
// connecter ne sert à rien, autant sortir pour que l'hébergeur le relance
// plutôt que de laisser tourner un process muet (le filet ci-dessus, sans ce
// catch, transformerait un jeton invalide en bot silencieux et immortel).
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("[bot] connexion à Discord impossible :", err.message);
  process.exit(1);
});
