const { PermissionFlagsBits } = require("discord.js");
const { buildNowPlayingPanel } = require("./nowPlayingPanel");
const { buildMusicHelpPanel, buildAdminHelpPanel } = require("./helpPanels");
const { hasModRole, MOD_ROLE_NAME } = require("./permissions");

const MAIN_PREFIX = "!";
const DASH_PREFIX = "-";
// Commandes disponibles avec le préfixe "-" (modération)
const DASH_COMMANDS = new Set(["clear", "renew", "hide", "unhide", "snipe", "help"]);

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function getQueueOrReply(client, message) {
  const queue = client.distube.getQueue(message.guildId);
  if (!queue) {
    message.reply("❌ Aucune musique en cours.");
    return null;
  }
  return queue;
}

function requireModRole(message) {
  if (!hasModRole(message)) {
    message.reply(`❌ Tu dois avoir le rôle **${MOD_ROLE_NAME}** pour utiliser cette commande.`);
    return false;
  }
  return true;
}

async function sendTempReply(channel, content, ms = 5000) {
  try {
    const msg = await channel.send(content);
    setTimeout(() => msg.delete().catch(() => {}), ms);
  } catch {
    /* ignore */
  }
}

const handlers = {
  // ---- Musique ----
  async play(client, message, args) {
    const query = args.join(" ");
    if (!query) return message.reply("❌ Indique une recherche, un lien YouTube ou Spotify.");
    const vc = message.member.voice.channel;
    if (!vc) return message.reply("❌ Tu dois être dans un salon vocal.");
    try {
      await client.distube.play(vc, query, { textChannel: message.channel, member: message.member });
      await message.reply(`🔎 Recherche en cours pour : **${query}**`);
    } catch (err) {
      console.error(err);
      await message.reply("❌ Impossible de jouer ce titre.");
    }
  },

  async skip(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    try {
      const song = await queue.skip();
      await message.reply(`⏭️ Passé à : **${song.name}**`);
    } catch {
      await message.reply("❌ Rien à passer.");
    }
  },

  async stop(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    queue.stop();
    await message.reply("⏹️ Musique arrêtée et file d'attente vidée.");
  },

  async pause(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    queue.pause();
    await message.reply("⏸️ Musique en pause.");
  },

  async resume(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    queue.resume();
    await message.reply("▶️ Musique reprise.");
  },

  async queue(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    if (queue.songs.length === 0) return message.reply("❌ La file d'attente est vide.");
    const list = queue.songs
      .slice(0, 15)
      .map((s, i) => `${i === 0 ? "▶️" : `${i}.`} **${s.name}** - ${s.formattedDuration}`)
      .join("\n");
    await message.reply(`📜 **File d'attente (${queue.songs.length} titres) :**\n${list}`);
  },

  async volume(client, message, args) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    const niveau = parseInt(args[0], 10);
    if (isNaN(niveau) || niveau < 0 || niveau > 150) {
      return message.reply("❌ Indique un volume entre 0 et 150. Ex : `!volume 80`");
    }
    queue.setVolume(niveau);
    await message.reply(`🔊 Volume réglé sur **${niveau}%**.`);
  },

  async loop(client, message, args) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    const map = { off: 0, désactivé: 0, "0": 0, song: 1, chanson: 1, "1": 1, queue: 2, file: 2, "2": 2 };
    const key = (args[0] || "").toLowerCase();
    const mode = map[key];
    if (mode === undefined) {
      return message.reply("❌ Mode invalide. Utilise : `!loop off|song|queue`");
    }
    queue.setRepeatMode(mode);
    const labels = ["Désactivée", "Chanson", "File d'attente"];
    await message.reply(`🔁 Mode de répétition : **${labels[mode]}**`);
  },

  // ---- Aide ----
  async help(client, message) {
    await message.channel.send(buildMusicHelpPanel());
  },

  // ---- Modération (préfixe "-") ----
  async clear(client, message, args) {
    if (!requireModRole(message)) return;
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply("❌ Il me manque la permission **Gérer les messages**.");
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
        return sendTempReply(
          channel,
          "❌ Utilisation : `-clear @membre` ou `-clear <nombre entier positif>`"
        );
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

    await sendTempReply(channel, `🧹 **${deletedTotal}** message(s) supprimé(s).`);
  },

  async renew(client, message) {
    if (!requireModRole(message)) return;
    const channel = message.channel;
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return message.reply("❌ Il me manque la permission **Gérer les salons**.");
    }
    try {
      const clone = await channel.clone({ reason: `Salon renouvelé par ${message.author.tag}` });
      await clone.setPosition(channel.position).catch(() => {});
      await channel.delete().catch(() => {});
      await clone.send("♻️ Salon renouvelé.");
    } catch (err) {
      console.error(err);
      await message.channel.send("❌ Impossible de renouveler le salon.");
    }
  },

  async hide(client, message) {
    if (!requireModRole(message)) return;
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply("❌ Il me manque la permission **Gérer les rôles**.");
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { ViewChannel: false })
      .catch(() => {});
    await message.channel.send("🙈 Salon caché pour @everyone.");
  },

  async unhide(client, message) {
    if (!requireModRole(message)) return;
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply("❌ Il me manque la permission **Gérer les rôles**.");
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { ViewChannel: null })
      .catch(() => {});
    await message.channel.send("👁️ Salon de nouveau visible pour @everyone.");
  },

  async snipe(client, message) {
    if (!requireModRole(message)) return;
    const data = client.snipes.get(message.channel.id);
    if (!data) {
      return message.reply("❌ Rien à sniper dans ce salon.");
    }
    const label = data.type === "cleared" ? "supprimé via une commande clear" : "supprimé";
    await message.channel.send(
      `🔍 Dernier message ${label} (par **${data.authorTag}**, <t:${Math.floor(data.timestamp / 1000)}:R>) :\n> ${data.content || "*[contenu vide ou non textuel]*"}`
    );
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