const { LOOP_LABELS } = require("./nowPlayingPanel");
const { buildMusicHelpPanel } = require("./helpPanels");
const { buildStatusEmbed } = require("./statusEmbed");
const { handleSpotifyPlay } = require("./spotifyPlay");
const { queueAndPlay, stopNowPlayingTracking, setPlayerPaused } = require("./musicPlayer");
const { handleJoinSpotify } = require("./joinSpotify");
const { getPrefixes } = require("./prefixStore");
const { playbackErrorMessage, unresolvedQueryMessage } = require("./musicErrors");
const { buildFavoritesPanel } = require("./favoritesPanel");
const accessStore = require("./accessStore");
const { can } = require("./permissions/engine");
const { channelHandlers } = require("./channelCommands");
const { buildHelpPanel } = require("./helpPanel");
const { buildConfigPanel, hasAnyPanelAccess } = require("./configPanel");
const { publicHandlers } = require("./publicCommands");
const { handleBanAll } = require("./banAll");
const { handleBan, handleUnban } = require("./banPanel");
const { moderationHandlers } = require("./moderationCommands");
const serverAdmin = require("./serverAdminCommands");
const { canControlPlayer, requestPlayerAccess, clearPlayerControl } = require("./playerControl");
const { noteManualSkip } = require("./deadTrack");
const { handleSourcesDiagnostic } = require("./sourcesDiagnostic");

const URL_REGEX = /^https?:\/\//i;
const LOOP_KEYWORDS = {
  off: "none",
  désactivé: "none",
  "0": "none",
  song: "track",
  chanson: "track",
  "1": "track",
  queue: "queue",
  file: "queue",
  "2": "queue",
};

function getPlayerOrReply(client, message) {
  const player = client.kazagumo.players.get(message.guildId);
  if (!player) {
    message.reply({ embeds: [buildStatusEmbed("error", "Aucune musique en cours.")] });
    return null;
  }
  return player;
}

/**
 * Vérifie que l'auteur du message peut utiliser une commande de contrôle
 * (pause/skip/stop/volume/loop/leave) : seule la personne qui a amené le bot
 * en vocal (ou quelqu'un qu'elle a autorisée) le peut — voir utils/playerControl.js.
 * Si ce n'est pas le cas, envoie une demande d'autorisation au propriétaire.
 * @returns {Promise<boolean>} true si la commande peut continuer
 */
async function requirePlayerControl(client, message) {
  if (canControlPlayer(client, message.guildId, message.author.id)) return true;
  requestPlayerAccess(client, message.channel, message.author, message.guildId);
  await message.reply({
    embeds: [
      buildStatusEmbed(
        "info",
        "Cette commande est réservée à la personne qui a lancé la musique. Une demande d'autorisation lui a été envoyée."
      ),
    ],
  });
  return false;
}

const handlers = {
  async play(client, message, args) {
    const query = args.join(" ");
    // Sans titre : on propose la playlist des favoris plutôt que de renvoyer
    // une erreur (voir utils/favoritesPanel.js).
    if (!query) {
      const { main } = getPrefixes(message.guild.id);
      const panel = buildFavoritesPanel(message.author.id, main);
      if (panel) return message.reply(panel);
      return message.reply({
        embeds: [
          buildStatusEmbed(
            "error",
            `Indique un nom de musique/artiste, ou un lien YouTube/Spotify.\nTu n'as encore aucun favori — ajoute-en avec le bouton **Favori** du panel de lecture.`
          ),
        ],
      });
    }
    const vc = message.member.voice.channel;
    if (!vc)
      return message.reply({ embeds: [buildStatusEmbed("error", "Tu dois être dans un salon vocal.")] });

    if (URL_REGEX.test(query)) {
      try {
        const outcome = await queueAndPlay(client.kazagumo, {
          voiceChannel: vc,
          textChannel: message.channel,
          member: message.member,
          query,
          client,
        });
        if (!outcome) {
          return message.reply({ embeds: [buildStatusEmbed("error", unresolvedQueryMessage(query))] });
        }
        const label = outcome.alreadyPlaying ? "Ajouté à la file d'attente" : "Lancement de";
        await message.reply({
          embeds: [buildStatusEmbed("info", `${label} : **${outcome.result.tracks[0].title}**`)],
        });
      } catch (err) {
        console.error(err);
        await message.reply({
          embeds: [buildStatusEmbed("error", playbackErrorMessage(err, unresolvedQueryMessage(query)))],
        });
      }
      return;
    }

    await handleSpotifyPlay({
      kazagumo: client.kazagumo,
      client,
      voiceChannel: vc,
      textChannel: message.channel,
      member: message.member,
      query,
      requesterId: message.author.id,
      send: (payload) => message.reply(payload),
    });
  },

  async join(client, message) {
    const vc = message.member.voice.channel;
    if (!vc)
      return message.reply({ embeds: [buildStatusEmbed("error", "Tu dois être dans un salon vocal.")] });

    const listenerMember = message.mentions.members?.first() || message.member;

    await handleJoinSpotify({
      client,
      voiceChannel: vc,
      textChannel: message.channel,
      listenerMember,
      playerMember: message.member,
      send: (payload) => message.reply(payload),
    });
  },

  async skip(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    if (!player.queue.current) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Rien à passer.")] });
    }
    noteManualSkip(message.guildId);
    player.skip();
    await message.reply({ embeds: [buildStatusEmbed("success", "Musique passée.")] });
  },

  async stop(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    stopNowPlayingTracking(client, message.guildId);
    clearPlayerControl(client, message.guildId);
    player.destroy();
    await message.reply({
      embeds: [buildStatusEmbed("success", "Musique arrêtée et file d'attente vidée.")],
    });
  },

  async leave(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    stopNowPlayingTracking(client, message.guildId);
    clearPlayerControl(client, message.guildId);
    player.destroy();
    await message.reply({ embeds: [buildStatusEmbed("success", "J'ai quitté le salon vocal.")] });
  },

  async pause(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    setPlayerPaused(player, true);
    await message.reply({ embeds: [buildStatusEmbed("success", "Musique en pause.")] });
  },

  async resume(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    setPlayerPaused(player, false);
    await message.reply({ embeds: [buildStatusEmbed("success", "Musique reprise.")] });
  },

  async queue(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    const tracks = [player.queue.current, ...player.queue].filter(Boolean);
    if (tracks.length === 0)
      return message.reply({ embeds: [buildStatusEmbed("error", "La file d'attente est vide.")] });
    const list = tracks
      .slice(0, 15)
      .map((t, i) => `${i === 0 ? "En cours :" : `${i}.`} **${t.title}**`)
      .join("\n");
    await message.reply({
      embeds: [
        buildStatusEmbed("info", list, { title: `File d'attente (${tracks.length} titres)` }),
      ],
    });
  },

  async volume(client, message, args) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    const niveau = parseInt(args[0], 10);
    if (isNaN(niveau) || niveau < 0 || niveau > 150) {
      const { main } = getPrefixes(message.guild.id);
      return message.reply({
        embeds: [buildStatusEmbed("error", `Indique un volume entre 0 et 150. Ex : \`${main}volume 80\``)],
      });
    }
    player.setVolume(niveau);
    await message.reply({
      embeds: [buildStatusEmbed("success", `Volume réglé sur **${niveau}%**.`)],
    });
  },

  async loop(client, message, args) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    const mode = LOOP_KEYWORDS[(args[0] || "").toLowerCase()];
    if (!mode) {
      const { main } = getPrefixes(message.guild.id);
      return message.reply({
        embeds: [buildStatusEmbed("error", `Mode invalide. Utilise : \`${main}loop off|song|queue\``)],
      });
    }
    player.setLoop(mode);
    await message.reply({
      embeds: [buildStatusEmbed("success", `Mode de répétition : **${LOOP_LABELS[mode]}**`)],
    });
  },
};
// Commandes sur le préfixe "&" (musicMod). Ce préfixe est aussi celui du
// CrowBot présent sur le serveur : le bot reste donc MUET sur tout ce qui
// n'est pas listé ici, pour ne jamais répondre à la place de l'autre.
/** N'exécute `handler` que si la personne a la portée demandée, sinon rien. */
function requireScope(scope, handler) {
  return async (client, message, args) => {
    if (!accessStore.isAllowed(scope, message.author.id)) return;
    return handler(client, message, args);
  };
}

/**
 * Même chose via le moteur de permissions central (utils/permissions/engine.js) :
 * un pont de rétrocompatibilité y garde l'ancienne portée "salon" valide
 * pour "channels.lock"/"channels.manage", donc migrer ces commandes ici ne
 * casse aucun accès déjà accordé, tout en les rendant octroyables par rôle
 * depuis le panel (section 6/7 du cahier des charges).
 */
function requirePermission(key, handler) {
  return async (client, message, args) => {
    if (!can(message.member, key)) return;
    return handler(client, message, args);
  };
}

const modHandlers = {
  // Ouvert à tout le monde, mais le contenu est filtré sur les droits réels
  // de la personne (voir utils/helpPanel.js).
  async help(client, message) {
    await message.reply(buildHelpPanel(message.guild.id, message.member));
  },

  // Commandes publiques d'affichage : aucune autorisation requise, elles ne
  // font que lire des informations.
  pic: publicHandlers.pic,
  banner: publicHandlers.banner,
  server: publicHandlers.server,
  snipe: publicHandlers.snipe,

  async panel(client, message) {
    if (!hasAnyPanelAccess(message.member)) return;
    await message.reply(buildConfigPanel(message.guild, "home", message.member));
  },

  // Dit d'où le son peut encore venir (voir utils/sourcesDiagnostic.js) : la
  // seule façon de trancher, depuis la production, entre "ce morceau n'existe
  // nulle part" et "cette source nous refuse l'accès".
  async sources(client, message, args) {
    if (!accessStore.isAllowed("sys", message.author.id)) return;
    await handleSourcesDiagnostic(client, message, args);
  },

  // Ces commandes vérifient leurs propres droits à l'intérieur (moteur de
  // permissions central, voir utils/permissions/engine.js) : banall inclut
  // le propriétaire du serveur, ce que requireScope ne sait pas exprimer, et
  // toutes restent muettes pour les non-autorisés plutôt que de répondre à
  // la place du CrowBot sur ce préfixe partagé.
  banall: handleBanAll,
  ban: handleBan,
  unban: handleUnban,

  renew: requirePermission("channels.manage", channelHandlers.renew),
  hide: requirePermission("channels.manage", channelHandlers.hide),
  unhide: requirePermission("channels.manage", channelHandlers.unhide),
  lock: requirePermission("channels.lock", channelHandlers.lock),
  unlock: requirePermission("channels.lock", channelHandlers.unlock),

  // Nouvelles commandes de modération (refonte permissions/rôles/logs/panel) —
  // chacune vérifie sa propre clé de permission via utils/permissions/engine.js.
  kick: moderationHandlers.kick,
  softban: moderationHandlers.softban,
  timeout: moderationHandlers.timeout,
  untimeout: moderationHandlers.untimeout,
  slowmode: moderationHandlers.slowmode,
  nick: moderationHandlers.nick,
  resetnick: moderationHandlers.resetnick,
  // "role create/delete/rename/color/admin" gère le rôle lui-même (voir
  // utils/serverAdminCommands.js) ; tout le reste ("role add/remove @membre
  // @rôle") gère l'appartenance d'un membre (utils/moderationCommands.js) —
  // une seule commande "&role" pour l'utilisateur, deux fichiers derrière.
  role: (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    if (serverAdmin.ROLE_ADMIN_SUBCOMMANDS.has(sub)) return serverAdmin.roleAdmin(client, message, args);
    return moderationHandlers.role(client, message, args);
  },
  modlogs: moderationHandlers.modlogs,
  clear: moderationHandlers.clear,
  purge: moderationHandlers.purge,
  lockdown: moderationHandlers.lockdown,
  panic: moderationHandlers.panic,
  unlockdown: moderationHandlers.unlockdown,

  // Administration du serveur (rôles/salons créés de zéro, owners, whitelist,
  // liste des bots, dero automatique) — voir utils/serverAdminCommands.js.
  channel: serverAdmin.channelAdmin,
  owners: serverAdmin.owners,
  whitelist: serverAdmin.whitelist,
  allbots: serverAdmin.allbots,
  dero: serverAdmin.dero,
  antinuke: serverAdmin.antinuke,
  voicehub: serverAdmin.voicehub,
  vc: serverAdmin.vc,

  // Publiques, sans vérification de droits — même famille que pic/banner/server.
  userinfo: moderationHandlers.userinfo,
  avatar: moderationHandlers.avatar,
  serverinfo: moderationHandlers.serverinfo,
};

/**
 * À appeler dans l'écouteur "messageCreate" du bot Musique.
 */
async function handleMusicTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { main: MAIN_PREFIX, musicMod: MOD_PREFIX } = getPrefixes(message.guild.id);

  // Préfixe "&" : partagé avec le CrowBot du serveur. On ne traite que les
  // commandes explicitement déclarées dans modHandlers et on sort en silence
  // pour tout le reste, qui appartient à l'autre bot.
  if (MOD_PREFIX && content.startsWith(MOD_PREFIX)) {
    const [modCmd, ...modArgs] = content.slice(MOD_PREFIX.length).trim().split(/\s+/);
    const handler = modHandlers[(modCmd || "").toLowerCase()];
    if (handler) return handler(client, message, modArgs);
    return;
  }

  if (!content.startsWith(MAIN_PREFIX)) return;

  const [cmdRaw, ...args] = content.slice(MAIN_PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  if (cmd === "help") {
    return message.channel.send(buildMusicHelpPanel(MAIN_PREFIX));
  }
  if (handlers[cmd]) {
    return handlers[cmd](client, message, args);
  }
}

module.exports = { handleMusicTextCommand };
