require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Collection } = require("discord.js");
const { Kazagumo } = require("kazagumo");
const { Connectors } = require("shoukaku");
const { buildNowPlayingPanel, buildStoppedPanel, LOOP_LABELS } = require("./utils/nowPlayingPanel");
const { handleTextCommand, rememberSnipe } = require("./utils/textCommands");
const { buildStatusEmbed } = require("./utils/statusEmbed");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  // Empêche tout ping accidentel de @everyone/@here/rôles (ex: titre de musique
  // ou message sniped contenant littéralement "@everyone"). Les mentions
  // d'utilisateurs restent autorisées.
  allowedMentions: { parse: ["users"], repliedUser: true },
});

// ---- Chargement des commandes slash ----
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

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
  LavalinkNodes
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

// Stocke le dernier message supprimé par salon (commande -snipe)
client.snipes = new Collection();

// ---- Événements Kazagumo ----
client.kazagumo
  .on("playerStart", async (player) => {
    const textChannel = client.channels.cache.get(player.textId);
    if (!textChannel) return;
    const panel = buildNowPlayingPanel(player);
    const msg = await textChannel.send(panel);
    client.nowPlayingMessages.set(player.guildId, msg);
  })
  .on("playerEmpty", (player) => {
    const textChannel = client.channels.cache.get(player.textId);
    client.nowPlayingMessages.delete(player.guildId);
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

// ---- Interactions : slash commands + boutons du panel ----
client.on("interactionCreate", async (interaction) => {
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

    switch (interaction.customId) {
      case "music_pauseresume":
        player.pause(!player.paused);
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
        client.nowPlayingMessages.delete(interaction.guildId);
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
    if (interaction.customId !== "music_stop" && client.kazagumo.players.get(interaction.guildId)) {
      const panel = buildNowPlayingPanel(client.kazagumo.players.get(interaction.guildId));
      await interaction.update(panel);
    } else {
      await interaction.update(buildStoppedPanel());
    }
  }
});

// ---- Commandes textuelles préfixées (! pour tout, - pour -clear / -renew) ----
client.on("messageCreate", (message) => {
  handleTextCommand(client, message).catch((err) => {
    console.error(err);
    message
      .reply({ embeds: [buildStatusEmbed("error", "Une erreur est survenue lors du traitement de la commande.")] })
      .catch(() => {});
  });
});

// ---- Mémorise les messages supprimés pour la commande -snipe ----
client.on("messageDelete", (message) => {
  if (!message.guild) return;
  rememberSnipe(client, message.channelId, message, "deleted");
});

// ---- Déconnecte le bot si tout le monde quitte le salon vocal ----
client.on("voiceStateUpdate", (oldState) => {
  const player = client.kazagumo.players.get(oldState.guild.id);
  if (!player || oldState.channelId !== player.voiceId) return;

  const voiceChannel = oldState.guild.channels.cache.get(player.voiceId);
  if (!voiceChannel) return;

  const humanCount = voiceChannel.members.filter((m) => !m.user.bot).size;
  if (humanCount === 0) {
    const textChannel = client.channels.cache.get(player.textId);
    client.nowPlayingMessages.delete(player.guildId);
    player.destroy();
    if (textChannel) {
      textChannel.send({
        embeds: [buildStatusEmbed("info", "Tout le monde a quitté le salon vocal, je me déconnecte.")],
      });
    }
  }
});

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
