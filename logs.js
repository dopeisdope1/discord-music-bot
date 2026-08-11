require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { handleLogsTextCommand } = require("./utils/logsCommands");
const { buildStatusEmbed } = require("./utils/statusEmbed");
const { loadGuildConfig } = require("./utils/configChannel");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Nécessaire pour lire la commande textuelle "=logs" — à activer
    // manuellement sur le portail développeur Discord (Bot > intents
    // privilégiés).
    GatewayIntentBits.MessageContent,
  ],
  allowedMentions: { parse: ["users"], repliedUser: true },
});

client.on("messageCreate", (message) => {
  handleLogsTextCommand(client, message).catch((err) => {
    console.error(err);
    message
      .reply({ embeds: [buildStatusEmbed("error", "Une erreur est survenue lors du traitement de la commande.")] })
      .catch(() => {});
  });
});

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    // Restaure la config (salons de logs, + lecture du préfixe modération
    // pour l'affichage dans =logs) : le disque du container Railway est
    // réinitialisé à chaque redéploiement, donc sans ça la config choisie
    // reviendrait aux valeurs par défaut à chaque push (voir
    // utils/configChannel.js, qui sauvegarde tout ça dans un salon Discord
    // caché partagé avec les autres bots).
    loadGuildConfig(guild).catch((err) => {
      console.warn(`⚠️ Impossible de restaurer la config du serveur "${guild.name}":`, err.message);
    });
  }
});

client.on("guildCreate", (guild) => {
  loadGuildConfig(guild).catch((err) => {
    console.warn(`⚠️ Impossible de restaurer la config du serveur "${guild.name}":`, err.message);
  });
});

let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] Signal ${signal} reçu, arrêt dans 3s (le temps que les sauvegardes en cours se terminent)...`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  client.destroy();
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

client.login(process.env.DISCORD_TOKEN);
