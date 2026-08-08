const { buildNowPlayingPanel } = require("./nowPlayingPanel");

const MAIN_PREFIX = "m!";
const DASH_PREFIX = "-";
// Seules ces deux commandes répondent au préfixe "-"
const DASH_COMMANDS = new Set(["clear", "renew"]);

function getQueueOrReply(client, message) {
  const queue = client.distube.getQueue(message.guildId);
  if (!queue) {
    message.reply("❌ Aucune musique en cours.");
    return null;
  }
  return queue;
}

function requireSameVoiceChannel(message, queue) {
  const vc = message.member.voice.channel;
  if (!vc || vc.id !== queue.voiceChannel.id) {
    message.reply("❌ Tu dois être dans le même salon vocal que le bot.");
    return false;
  }
  return true;
}

const handlers = {
  // ---- Lecture ----
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
      return message.reply("❌ Indique un volume entre 0 et 150. Ex : `m!volume 80`");
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
      return message.reply("❌ Mode invalide. Utilise : `m!loop off|song|queue`");
    }
    queue.setRepeatMode(mode);
    const labels = ["Désactivée", "Chanson", "File d'attente"];
    await message.reply(`🔁 Mode de répétition : **${labels[mode]}**`);
  },

  // ---- Commandes spéciales (préfixe "-") ----
  async clear(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    if (!requireSameVoiceChannel(message, queue)) return;

    const removed = queue.songs.length - 1; // on garde le titre en cours (index 0)
    if (removed <= 0) {
      return message.reply("ℹ️ La file d'attente est déjà vide.");
    }
    queue.songs.splice(1); // supprime tout sauf la musique en cours
    await message.reply(`🧹 File d'attente vidée (**${removed}** titre(s) retiré(s)).`);
  },

  async renew(client, message) {
    const queue = getQueueOrReply(client, message);
    if (!queue) return;
    if (!requireSameVoiceChannel(message, queue)) return;

    // Supprime l'ancien panel s'il existe encore
    const oldMsg = client.nowPlayingMessages.get(queue.id);
    if (oldMsg && oldMsg.deletable) {
      await oldMsg.delete().catch(() => {});
    }

    // Renvoie un panel Components V2 tout neuf, en bas du salon
    const panel = buildNowPlayingPanel(queue);
    const newMsg = await message.channel.send(panel);
    client.nowPlayingMessages.set(queue.id, newMsg);

    // Supprime discrètement le message de commande "-renew"
    if (message.deletable) message.delete().catch(() => {});
  },
};

/**
 * À appeler dans l'écouteur "messageCreate" du client.
 */
async function handleTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();

  // Préfixe "-" : uniquement -clear et -renew
  if (content.startsWith(DASH_PREFIX) && !content.startsWith(MAIN_PREFIX)) {
    const [cmdRaw, ...args] = content.slice(DASH_PREFIX.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    if (DASH_COMMANDS.has(cmd)) {
      return handlers[cmd](client, message, args);
    }
    return; // toute autre commande "-xxx" est ignorée
  }

  // Préfixe principal "m!"
  if (content.startsWith(MAIN_PREFIX)) {
    const [cmdRaw, ...args] = content.slice(MAIN_PREFIX.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    if (handlers[cmd]) {
      return handlers[cmd](client, message, args);
    }
  }
}

module.exports = { handleTextCommand, MAIN_PREFIX, DASH_PREFIX };
