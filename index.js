require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Collection,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const { DisTube } = require("distube");
const { SpotifyPlugin } = require("@distube/spotify");
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { buildNowPlayingPanel } = require("./utils/nowPlayingPanel");
const { handleTextCommand, rememberSnipe } = require("./utils/textCommands");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

// ---- Chargement des commandes slash ----
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// ---- Initialisation de DisTube (YouTube + Spotify) ----
client.distube = new DisTube(client, {
  emitNewSongOnly: true,
  emitAddSongWhenCreatingQueue: false,
  emitAddListWhenCreatingQueue: false,
  plugins: [
    new SpotifyPlugin({
      api: {
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      },
    }),
    new YtDlpPlugin({ update: false }),
  ],
});

// Stocke le dernier message "panel" par serveur pour pouvoir l'éditer
client.nowPlayingMessages = new Collection();

// Stocke le dernier message supprimé par salon (commande -snipe)
client.snipes = new Collection();

// ---- Événements DisTube ----
client.distube
  .on("playSong", async (queue) => {
    const panel = buildNowPlayingPanel(queue);
    const msg = await queue.textChannel.send(panel);
    client.nowPlayingMessages.set(queue.id, msg);
  })
  .on("addSong", (queue, song) => {
    queue.textChannel.send({
      content: `✅ Ajouté à la file d'attente : **${song.name}** (${song.formattedDuration})`,
    });
  })
  .on("addList", (queue, playlist) => {
    queue.textChannel.send({
      content: `✅ Playlist ajoutée : **${playlist.name}** (${playlist.songs.length} titres)`,
    });
  })
  .on("finish", (queue) => {
    queue.textChannel.send("🏁 File d'attente terminée.");
  })
  .on("disconnect", (queue) => {
    client.nowPlayingMessages.delete(queue.id);
  })
  .on("empty", (queue) => {
    queue.textChannel.send("👋 Tout le monde a quitté le salon vocal, je me déconnecte.");
  })
  .on("error", (channel, error) => {
    console.error(error);
    if (channel?.send) {
      channel.send("❌ Une erreur est survenue : " + error.message.slice(0, 1800));
    }
  });

// ---- Interactions : slash commands + boutons du panel ----
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      const payload = { content: "❌ Erreur lors de l'exécution de la commande.", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    }
    return;
  }

  if (interaction.isButton()) {
    const queue = client.distube.getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: "❌ Aucune musique en cours.", ephemeral: true });
    }

    const memberVoiceChannel = interaction.member.voice.channel;
    if (!memberVoiceChannel || memberVoiceChannel.id !== queue.voiceChannel.id) {
      return interaction.reply({
        content: "❌ Tu dois être dans le même salon vocal que le bot.",
        ephemeral: true,
      });
    }

    switch (interaction.customId) {
      case "music_pauseresume":
        queue.paused ? queue.resume() : queue.pause();
        break;
      case "music_skip":
        try {
          await queue.skip();
        } catch {
          return interaction.reply({ content: "❌ Rien à passer.", ephemeral: true });
        }
        break;
      case "music_stop":
        queue.stop();
        break;
      case "music_loop":
        queue.setRepeatMode((queue.repeatMode + 1) % 3);
        break;
      case "music_queue": {
        const list = queue.songs
          .slice(0, 10)
          .map((s, i) => `${i === 0 ? "▶️" : `${i}.`} ${s.name} - ${s.formattedDuration}`)
          .join("\n");
        return interaction.reply({
          content: "📜 **File d'attente :**\n" + list,
          ephemeral: true,
        });
      }
    }

    // Met à jour le panel après action (sauf stop, qui supprime la queue)
    if (interaction.customId !== "music_stop" && client.distube.getQueue(interaction.guildId)) {
      const panel = buildNowPlayingPanel(client.distube.getQueue(interaction.guildId));
      await interaction.update(panel);
    } else {
      await interaction.update({ content: "⏹️ Lecture arrêtée.", embeds: [], components: [] });
    }
  }
});

// ---- Commandes textuelles préfixées (m! pour tout, - pour -clear / -renew) ----
client.on("messageCreate", (message) => {
  handleTextCommand(client, message).catch((err) => {
    console.error(err);
    message.reply("❌ Une erreur est survenue lors du traitement de la commande.").catch(() => {});
  });
});

// ---- Mémorise les messages supprimés pour la commande -snipe ----
client.on("messageDelete", (message) => {
  if (!message.guild) return;
  rememberSnipe(client, message.channelId, message, "deleted");
});

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);