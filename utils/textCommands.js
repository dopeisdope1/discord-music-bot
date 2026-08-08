const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { LOOP_LABELS } = require("./nowPlayingPanel");
const { buildMusicHelpPanel, buildMemberDashHelpPanel, buildAdminHelpPanel } = require("./helpPanels");
const { hasModPermission } = require("./permissions");
const { buildStatusEmbed } = require("./statusEmbed");
const { handleSpotifyPlay } = require("./spotifyPlay");
const { queueAndPlay, stopNowPlayingTracking, setPlayerPaused } = require("./musicPlayer");
const { handleJoinSpotify } = require("./joinSpotify");
const { canUseDashCommand } = require("./commandPermissions");
const { handleCommandPanel, CONFIGURABLE_COMMANDS } = require("./commandPanelWizard");

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

const MAIN_PREFIX = "!";
const DASH_PREFIX = "-";
// Commandes "-" dont l'accès se configure via -panel (voir commandPermissions.js)
const DASH_COMMANDS = new Set(CONFIGURABLE_COMMANDS);

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function getPlayerOrReply(client, message) {
  const player = client.kazagumo.players.get(message.guildId);
  if (!player) {
    message.reply({ embeds: [buildStatusEmbed("error", "Aucune musique en cours.")] });
    return null;
  }
  return player;
}

function requireModPermission(message) {
  if (!hasModPermission(message)) {
    message.reply({
      embeds: [buildStatusEmbed("error", "Tu dois être administrateur du serveur pour utiliser cette commande.")],
    });
    return false;
  }
  return true;
}

async function sendTempReply(channel, content, ms = 5000) {
  try {
    const payload = typeof content === "string" ? { content } : content;
    const msg = await channel.send(payload);
    setTimeout(() => msg.delete().catch(() => {}), ms);
  } catch {
    /* ignore */
  }
}

const handlers = {
  // ---- Musique ----
  async play(client, message, args) {
    const query = args.join(" ");
    if (!query)
      return message.reply({
        embeds: [buildStatusEmbed("error", "Indique un nom de musique/artiste, ou un lien YouTube/Spotify.")],
      });
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
        });
        if (!outcome) {
          return message.reply({ embeds: [buildStatusEmbed("error", "Impossible de jouer ce titre. Vérifie le lien.")] });
        }
        const label = outcome.alreadyPlaying ? "Ajouté à la file d'attente" : "Lancement de";
        await message.reply({
          embeds: [buildStatusEmbed("info", `${label} : **${outcome.result.tracks[0].title}**`)],
        });
      } catch (err) {
        console.error(err);
        await message.reply({ embeds: [buildStatusEmbed("error", "Impossible de jouer ce titre. Vérifie le lien.")] });
      }
      return;
    }

    await handleSpotifyPlay({
      kazagumo: client.kazagumo,
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
    if (!player.queue.current) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Rien à passer.")] });
    }
    player.skip();
    await message.reply({ embeds: [buildStatusEmbed("success", "Musique passée.")] });
  },

  async stop(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    stopNowPlayingTracking(client, message.guildId);
    player.destroy();
    await message.reply({
      embeds: [buildStatusEmbed("success", "Musique arrêtée et file d'attente vidée.")],
    });
  },

  async pause(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    setPlayerPaused(player, true);
    await message.reply({ embeds: [buildStatusEmbed("success", "Musique en pause.")] });
  },

  async resume(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
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
    const niveau = parseInt(args[0], 10);
    if (isNaN(niveau) || niveau < 0 || niveau > 150) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Indique un volume entre 0 et 150. Ex : `!volume 80`")],
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
    const mode = LOOP_KEYWORDS[(args[0] || "").toLowerCase()];
    if (!mode) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Mode invalide. Utilise : `!loop off|song|queue`")],
      });
    }
    player.setLoop(mode);
    await message.reply({
      embeds: [buildStatusEmbed("success", `Mode de répétition : **${LOOP_LABELS[mode]}**`)],
    });
  },

  // ---- Aide ----
  async help(client, message) {
    await message.channel.send(buildMusicHelpPanel());
  },

  // ---- Modération (préfixe "-") ----
  async clear(client, message, args) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les messages**.")],
      });
    }

    const channel = message.channel;
    await message.delete().catch(() => {});

    const targetMember = message.mentions.members?.first();
    let deletedTotal = 0;

    if (targetMember) {
      let beforeId;
      for (let i = 0; i < 10; i++) {
        const fetched = await channel.messages.fetch({ limit: 100, before: beforeId });
        if (fetched.size === 0) break;
        beforeId = fetched.last().id;

        const fromMember = fetched.filter(
          (m) => m.author.id === targetMember.id && Date.now() - m.createdTimestamp < FOURTEEN_DAYS_MS
        );
        if (fromMember.size > 0) {
          const deleted = await channel.bulkDelete(fromMember, true).catch(() => null);
          if (deleted) {
            deletedTotal += deleted.size;
            const last = [...deleted.values()][0];
            if (last) rememberSnipe(client, channel.id, last, "cleared");
          }
        }
        if (fetched.size < 100) break;
      }
    } else {
      const amount = parseInt(args[0], 10);
      if (isNaN(amount) || amount <= 0 || !Number.isInteger(amount)) {
        return sendTempReply(channel, {
          embeds: [
            buildStatusEmbed("error", "Utilisation : `-clear @membre` ou `-clear <nombre entier positif>`"),
          ],
        });
      }

      let remaining = amount;
      while (remaining > 0) {
        const batch = Math.min(remaining, 100);
        const fetched = await channel.messages.fetch({ limit: batch });
        if (fetched.size === 0) break;

        const deletable = fetched.filter((m) => Date.now() - m.createdTimestamp < FOURTEEN_DAYS_MS);
        const deleted = await channel.bulkDelete(deletable, true).catch(() => null);
        if (deleted) {
          deletedTotal += deleted.size;
          const last = [...deleted.values()][0];
          if (last) rememberSnipe(client, channel.id, last, "cleared");
        }
        remaining -= fetched.size;
        if (fetched.size < batch) break;
      }
    }

    await sendTempReply(channel, {
      embeds: [buildStatusEmbed("success", `**${deletedTotal}** message(s) supprimé(s).`)],
    });
  },

  async renew(client, message) {
    const channel = message.channel;
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les salons**.")],
      });
    }
    try {
      const clone = await channel.clone({ reason: `Salon renouvelé par ${message.author.tag}` });
      await clone.setPosition(channel.position).catch(() => {});
      await channel.delete().catch(() => {});
      await clone.send({ embeds: [buildStatusEmbed("success", "Salon renouvelé.")] });
    } catch (err) {
      console.error(err);
      await message.channel.send({
        embeds: [buildStatusEmbed("error", "Impossible de renouveler le salon.")],
      });
    }
  },

  async hide(client, message) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les rôles**.")],
      });
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { ViewChannel: false })
      .catch(() => {});
    await message.channel.send({
      embeds: [buildStatusEmbed("info", "Salon caché pour @everyone.")],
      allowedMentions: { parse: [] },
    });
  },

  async unhide(client, message) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les rôles**.")],
      });
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { ViewChannel: null })
      .catch(() => {});
    await message.channel.send({
      embeds: [buildStatusEmbed("success", "Salon de nouveau visible pour @everyone.")],
      allowedMentions: { parse: [] },
    });
  },

  async lock(client, message) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les rôles**.")],
      });
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { SendMessages: false })
      .catch(() => {});
    await message.channel.send({
      embeds: [
        buildStatusEmbed("warning", "Salon verrouillé : @everyone ne peut plus écrire ici."),
      ],
      allowedMentions: { parse: [] },
    });
  },

  async unlock(client, message) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les rôles**.")],
      });
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { SendMessages: null })
      .catch(() => {});
    await message.channel.send({
      embeds: [
        buildStatusEmbed("success", "Salon déverrouillé : @everyone peut de nouveau écrire."),
      ],
      allowedMentions: { parse: [] },
    });
  },

  async pic(client, message) {
    const target = message.mentions.members?.first() || message.member;
    const avatarUrl = target.displayAvatarURL({ size: 1024 });
    await message.reply({
      embeds: [new EmbedBuilder().setTitle(`Photo de profil de ${target.displayName}`).setImage(avatarUrl)],
    });
  },

  async avatar(client, message, args) {
    return handlers.pic(client, message, args);
  },

  async snipe(client, message) {
    const data = client.snipes.get(message.channel.id);
    if (!data) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Rien à sniper dans ce salon.")] });
    }
    const label = data.type === "cleared" ? "supprimé via une commande clear" : "supprimé";
    await message.channel.send({
      embeds: [
        buildStatusEmbed(
          "info",
          `Par **${data.authorTag}**, <t:${Math.floor(data.timestamp / 1000)}:R> — ${label}\n> ${
            data.content || "*[contenu vide ou non textuel]*"
          }`,
          { title: "Message sniped" }
        ),
      ],
      allowedMentions: { parse: [] },
    });
  },

  async panel(client, message) {
    await handleCommandPanel(message);
  },
};

/**
 * Enregistre un message pour la commande -snipe.
 */
function rememberSnipe(client, channelId, message, type) {
  if (!message?.author || message.author.bot) return;
  client.snipes.set(channelId, {
    content: message.content,
    authorTag: message.author.tag,
    timestamp: Date.now(),
    type,
  });
}

/**
 * À appeler dans l'écouteur "messageCreate" du client.
 */
async function handleTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();

  // Préfixe "-" : commandes membres + modération
  if (content.startsWith(DASH_PREFIX) && !content.startsWith(MAIN_PREFIX)) {
    const [cmdRaw, ...args] = content.slice(DASH_PREFIX.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    if (cmd === "help") {
      const panel = hasModPermission(message) ? buildAdminHelpPanel() : buildMemberDashHelpPanel();
      return message.channel.send(panel);
    }
    if (cmd === "panel") {
      if (!requireModPermission(message)) return;
      return handlers.panel(client, message, args);
    }
    if (!DASH_COMMANDS.has(cmd)) return;

    const { allowed, reason } = canUseDashCommand(message, cmd);
    if (!allowed) {
      const text =
        reason === "channel"
          ? "Cette commande n'est pas autorisée dans ce salon."
          : "Tu n'as pas la permission d'utiliser cette commande.";
      return message.reply({ embeds: [buildStatusEmbed("error", text)] });
    }
    return handlers[cmd](client, message, args);
  }

  // Préfixe principal "m!"
  if (content.startsWith(MAIN_PREFIX)) {
    const [cmdRaw, ...args] = content.slice(MAIN_PREFIX.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    if (cmd === "help") {
      return message.channel.send(buildMusicHelpPanel());
    }
    if (handlers[cmd]) {
      return handlers[cmd](client, message, args);
    }
  }
}

module.exports = { handleTextCommand, rememberSnipe, MAIN_PREFIX, DASH_PREFIX };