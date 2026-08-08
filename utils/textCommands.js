const { PermissionFlagsBits } = require("discord.js");
const { buildNowPlayingPanel } = require("./nowPlayingPanel");
const { buildMusicHelpPanel, buildAdminHelpPanel } = require("./helpPanels");
const { hasModRole, MOD_ROLE_NAME } = require("./permissions");
const { buildStatusEmbed } = require("./statusEmbed");
const { handleSpotifyPlay } = require("./spotifyPlay");

const URL_REGEX = /^https?:\/\//i;

const MAIN_PREFIX = "!";
const DASH_PREFIX = "-";
// Commandes disponibles avec le préfixe "-" (modération)
const DASH_COMMANDS = new Set(["clear", "renew", "hide", "unhide", "lock", "unlock", "snipe", "help"]);

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function getQueueOrReply(client, message) {
  const queue = client.distube.getQueue(message.guildId);
  if (!queue) {
    message.reply({ embeds: [buildStatusEmbed("error", "Aucune musique en cours.")] });
    return null;
  }
  return queue;
}

function requireModRole(message) {
  if (!hasModRole(message)) {
    message.reply({
      embeds: [
        buildStatusEmbed("error", `Tu dois avoir le rôle **${MOD_ROLE_NAME}** pour utiliser cette commande.`),
      ],
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
        await client.distube.play(vc, query, { textChannel: message.channel, member: message.member });
        await message.reply({
          embeds: [buildStatusEmbed("info", `Recherche en cours pour : **${query}**`, { icon: "🔎" })],
        });
      } catch (err) {
        console.error(err);
        await message.reply({ embeds: [buildStatusEmbed("error", "Impossible de jouer ce titre. Vérifie le lien.")] });
      }
      return;
    }

    await handleSpotifyPlay({
      distube: client.distube,
      voiceChannel: vc,
      textChannel: message.channel,
      member: message.member,
      query,
      requesterId: message.author.id,
      send: (payload) => message.reply(payload),
    });
  },

  async skip(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    try {
      const song = await queue.skip();
      await message.reply({
        embeds: [buildStatusEmbed("success", `Passé à : **${song.name}**`, { icon: "⏭️" })],
      });
    } catch {
      await message.reply({ embeds: [buildStatusEmbed("error", "Rien à passer.")] });
    }
  },

  async stop(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    queue.stop();
    await message.reply({
      embeds: [buildStatusEmbed("success", "Musique arrêtée et file d'attente vidée.", { icon: "⏹️" })],
    });
  },

  async pause(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    queue.pause();
    await message.reply({ embeds: [buildStatusEmbed("success", "Musique en pause.", { icon: "⏸️" })] });
  },

  async resume(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    queue.resume();
    await message.reply({ embeds: [buildStatusEmbed("success", "Musique reprise.", { icon: "▶️" })] });
  },

  async queue(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    if (queue.songs.length === 0)
      return message.reply({ embeds: [buildStatusEmbed("error", "La file d'attente est vide.")] });
    const list = queue.songs
      .slice(0, 15)
      .map((s, i) => `${i === 0 ? "▶️" : `${i}.`} **${s.name}** - ${s.formattedDuration}`)
      .join("\n");
    await message.reply({
      embeds: [
        buildStatusEmbed("info", list, { title: `📜 File d'attente (${queue.songs.length} titres)`, icon: "" }),
      ],
    });
  },

  async volume(client, message, args) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    const niveau = parseInt(args[0], 10);
    if (isNaN(niveau) || niveau < 0 || niveau > 150) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Indique un volume entre 0 et 150. Ex : `!volume 80`")],
      });
    }
    queue.setVolume(niveau);
    await message.reply({
      embeds: [buildStatusEmbed("success", `Volume réglé sur **${niveau}%**.`, { icon: "🔊" })],
    });
  },

  async loop(client, message, args) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    const map = { off: 0, désactivé: 0, "0": 0, song: 1, chanson: 1, "1": 1, queue: 2, file: 2, "2": 2 };
    const key = (args[0] || "").toLowerCase();
    const mode = map[key];
    if (mode === undefined) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Mode invalide. Utilise : `!loop off|song|queue`")],
      });
    }
    queue.setRepeatMode(mode);
    const labels = ["Désactivée", "Chanson", "File d'attente"];
    await message.reply({
      embeds: [buildStatusEmbed("success", `Mode de répétition : **${labels[mode]}**`, { icon: "🔁" })],
    });
  },

  // ---- Aide ----
  async help(client, message) {
    await message.channel.send(buildMusicHelpPanel());
  },

  // ---- Modération (préfixe "-") ----
  async clear(client, message, args) {
    if (!requireModRole(message)) return;
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
      embeds: [buildStatusEmbed("success", `**${deletedTotal}** message(s) supprimé(s).`, { icon: "🧹" })],
    });
  },

  async renew(client, message) {
    if (!requireModRole(message)) return;
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
      await clone.send({ embeds: [buildStatusEmbed("success", "Salon renouvelé.", { icon: "♻️" })] });
    } catch (err) {
      console.error(err);
      await message.channel.send({
        embeds: [buildStatusEmbed("error", "Impossible de renouveler le salon.")],
      });
    }
  },

  async hide(client, message) {
    if (!requireModRole(message)) return;
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les rôles**.")],
      });
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { ViewChannel: false })
      .catch(() => {});
    await message.channel.send({
      embeds: [buildStatusEmbed("info", "Salon caché pour @everyone.", { icon: "🙈" })],
      allowedMentions: { parse: [] },
    });
  },

  async unhide(client, message) {
    if (!requireModRole(message)) return;
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les rôles**.")],
      });
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { ViewChannel: null })
      .catch(() => {});
    await message.channel.send({
      embeds: [buildStatusEmbed("success", "Salon de nouveau visible pour @everyone.", { icon: "👁️" })],
      allowedMentions: { parse: [] },
    });
  },

  async lock(client, message) {
    if (!requireModRole(message)) return;
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
        buildStatusEmbed("warning", "Salon verrouillé : @everyone ne peut plus écrire ici.", { icon: "🔒" }),
      ],
      allowedMentions: { parse: [] },
    });
  },

  async unlock(client, message) {
    if (!requireModRole(message)) return;
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
        buildStatusEmbed("success", "Salon déverrouillé : @everyone peut de nouveau écrire.", { icon: "🔓" }),
      ],
      allowedMentions: { parse: [] },
    });
  },

  async snipe(client, message) {
    if (!requireModRole(message)) return;
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
          { title: "🔍 Message sniped", icon: "" }
        ),
      ],
      allowedMentions: { parse: [] },
    });
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

  // Préfixe "-" : commandes de modération
  if (content.startsWith(DASH_PREFIX) && !content.startsWith(MAIN_PREFIX)) {
    const [cmdRaw, ...args] = content.slice(DASH_PREFIX.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    if (cmd === "help") {
      return message.channel.send(buildAdminHelpPanel());
    }
    if (DASH_COMMANDS.has(cmd)) {
      return handlers[cmd](client, message, args);
    }
    return;
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