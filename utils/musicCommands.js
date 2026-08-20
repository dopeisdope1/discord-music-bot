const { LOOP_LABELS } = require("./nowPlayingPanel");
const { buildMusicHelpPanel } = require("./helpPanels");
const { buildStatusEmbed } = require("./statusEmbed");
const { handleSpotifyPlay } = require("./spotifyPlay");
const { queueAndPlay, stopNowPlayingTracking, setPlayerPaused } = require("./musicPlayer");
const { handleJoinSpotify } = require("./joinSpotify");
const { getPrefixes } = require("./prefixStore");
const { waitForHydration } = require("./configChannel");
const { playbackErrorMessage, unresolvedQueryMessage } = require("./musicErrors");
const { buildFavoritesPanel } = require("./favoritesPanel");
const accessStore = require("./accessStore");
const { channelHandlers } = require("./channelCommands");
const { buildHelpPanel } = require("./helpPanel");
const { buildConfigPanel } = require("./configPanel");
const { canControlPlayer, requestPlayerAccess, clearPlayerControl } = require("./playerControl");

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

/**
 * Fabrique la commande qui gère une portée d'autorisations (voir
 * utils/accessStore.js). La logique est la même pour les clear et pour les
 * salons, seuls les libellés changent.
 */
function accessCommand(scope, labels) {
  return async function (client, message, args) {
    // Silence total pour ceux qui n'y ont pas droit : pas même un refus, afin
    // de ne rien afficher si quelqu'un d'autre tape cette commande.
    if (!accessStore.isAllowed("sys", message.author.id)) return;

    const { musicMod } = getPrefixes(message.guild.id);
    const usage = `\`${musicMod}${labels.command} add @membre\` · \`remove @membre\` · \`list\``;
    const action = (args[0] || "").toLowerCase();

    if (action === "list") {
      const ids = accessStore.list(scope);
      return message.reply({
        embeds: [
          buildStatusEmbed(
            "info",
            ids.length
              ? `${labels.title} :\n${ids.map((id) => `<@${id}>`).join(", ")}`
              : "Personne pour l'instant. Toi, tu l'es toujours."
          ),
        ],
      });
    }

    if (action !== "add" && action !== "remove") {
      return message.reply({ embeds: [buildStatusEmbed("error", `Utilisation : ${usage}`)] });
    }

    const target = message.mentions.users?.first();
    const rawId = args[1]?.replace(/\D/g, "");
    const userId = target?.id || (rawId?.length >= 15 ? rawId : null);
    if (!userId) {
      return message.reply({ embeds: [buildStatusEmbed("error", `Mentionne un membre ou donne son ID.\n${usage}`)] });
    }

    if (accessStore.isOwner(userId)) {
      return message.reply({
        embeds: [buildStatusEmbed("info", `<@${userId}> est propriétaire du bot, il a déjà tous les accès.`)],
      });
    }

    if (action === "add") {
      const added = accessStore.add(scope, userId);
      return message.reply({
        embeds: [buildStatusEmbed(added ? "success" : "info", added ? labels.granted(userId) : `<@${userId}> l'était déjà.`)],
      });
    }

    const removed = accessStore.remove(scope, userId);
    return message.reply({
      embeds: [buildStatusEmbed(removed ? "success" : "info", removed ? labels.revoked(userId) : `<@${userId}> ne l'était pas.`)],
    });
  };
}

/** N'exécute `handler` que si la personne a la portée demandée, sinon rien. */
function requireScope(scope, handler) {
  return async (client, message, args) => {
    if (!accessStore.isAllowed(scope, message.author.id)) return;
    return handler(client, message, args);
  };
}

const modHandlers = {
  // Ouvert à tout le monde, mais le contenu est filtré sur les droits réels
  // de la personne (voir utils/helpPanel.js).
  async help(client, message) {
    await message.reply(buildHelpPanel(message.guild.id, message.author.id));
  },

  async panel(client, message) {
    if (!accessStore.isAllowed("sys", message.author.id)) return;
    await message.reply(buildConfigPanel(message.guild.id));
  },

  // Rang "sys" : accès à tout le bot. Réservé au propriétaire — un sys ne
  // peut pas en créer d'autres, sinon l'accès deviendrait irrévocable depuis
  // l'intérieur (voir utils/accessStore.js).
  async zinki(client, message, args) {
    if (!accessStore.isOwner(message.author.id)) return;

    const { musicMod } = getPrefixes(message.guild.id);
    const usage = `\`${musicMod}zinki @membre\` · \`${musicMod}zinki remove @membre\` · \`${musicMod}zinki list\``;
    const first = (args[0] || "").toLowerCase();

    if (first === "list") {
      const ids = accessStore.list("sys");
      return message.reply({
        embeds: [
          buildStatusEmbed(
            "info",
            ids.length ? `Rang sys :\n${ids.map((id) => `<@${id}>`).join(", ")}` : "Personne n'a le rang sys."
          ),
        ],
      });
    }

    // `remove` en premier mot, sinon la cible est directement en premier
    // argument : `&zinki @membre` doit suffire à accorder le rang.
    const removing = first === "remove";
    const target = message.mentions.users?.first();
    const rawId = (removing ? args[1] : args[0])?.replace(/\D/g, "");
    const userId = target?.id || (rawId?.length >= 15 ? rawId : null);

    if (!userId) return message.reply({ embeds: [buildStatusEmbed("error", `Utilisation : ${usage}`)] });

    if (accessStore.isOwner(userId)) {
      return message.reply({
        embeds: [buildStatusEmbed("info", `<@${userId}> est propriétaire du bot, il a déjà tous les accès.`)],
      });
    }

    if (removing) {
      const removed = accessStore.remove("sys", userId);
      return message.reply({
        embeds: [
          buildStatusEmbed(
            removed ? "success" : "info",
            removed ? `<@${userId}> n'a plus le rang sys.` : `<@${userId}> n'avait pas le rang sys.`
          ),
        ],
      });
    }

    const added = accessStore.add("sys", userId);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          added ? "success" : "info",
          added ? `<@${userId}> a désormais le rang **sys** : accès à tout le bot.` : `<@${userId}> avait déjà le rang sys.`
        ),
      ],
    });
  },

  clearbypass: accessCommand("clear", {
    command: "clearbypass",
    title: "Dispensés du quota des clear",
    granted: (id) => `<@${id}> peut désormais utiliser les clear sans limite.`,
    revoked: (id) => `<@${id}> repasse sous le quota normal.`,
  }),
  salonperm: accessCommand("salon", {
    command: "salonperm",
    title: "Autorisés sur les commandes de salon",
    granted: (id) => `<@${id}> peut désormais utiliser renew, hide, unhide, lock et unlock.`,
    revoked: (id) => `<@${id}> n'a plus accès aux commandes de salon.`,
  }),
  renew: requireScope("salon", channelHandlers.renew),
  hide: requireScope("salon", channelHandlers.hide),
  unhide: requireScope("salon", channelHandlers.unhide),
  lock: requireScope("salon", channelHandlers.lock),
  unlock: requireScope("salon", channelHandlers.unlock),
};

/**
 * À appeler dans l'écouteur "messageCreate" du bot Musique.
 */
async function handleMusicTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  // Si le bot vient de redémarrer, attend que le préfixe ait fini d'être
  // restauré depuis Discord avant de le lire (voir utils/configChannel.js).
  await waitForHydration(message.guild.id);

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
