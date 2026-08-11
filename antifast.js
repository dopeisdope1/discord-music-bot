require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { handleAntifastTextCommand } = require("./utils/antifastCommands");
const { registerAntiNuke } = require("./utils/antiNuke");
const { buildStatusEmbed } = require("./utils/statusEmbed");
const { loadGuildConfig } = require("./utils/configChannel");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Nécessaire pour lire les commandes textuelles (=antifast, =owner, =wl,
    // =allbots) — à activer manuellement sur le portail développeur Discord
    // (Bot > intents privilégiés).
    GatewayIntentBits.MessageContent,
    // Nécessaire pour guildMemberRemove/guildMemberUpdate/guildMemberAdd
    // (détection anti-nuke) et pour que `=allbots` puisse lister les
    // membres — à activer manuellement sur le portail développeur Discord,
    // comme MESSAGE CONTENT.
    GatewayIntentBits.GuildMembers,
    // Nécessaires pour détecter les bannissements (guildBanAdd), les
    // créations de webhook (webhooksUpdate), les événements planifiés
    // (guildScheduledEvent*) et les déconnexions vocales en masse
    // (voiceStateUpdate) — aucun n'est privilégié, rien à activer sur le
    // portail développeur.
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.GuildVoiceStates,
  ],
  allowedMentions: { parse: ["users"], repliedUser: true },
});

client.on("messageCreate", (message) => {
  handleAntifastTextCommand(client, message).catch((err) => {
    console.error(err);
    message
      .reply({ embeds: [buildStatusEmbed("error", "Une erreur est survenue lors du traitement de la commande.")] })
      .catch(() => {});
  });
});

// ---- Protection anti-nuke ("=antifast") ----
registerAntiNuke(client);

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    // Restaure la config antifast (owners, whitelist, seuils...) : le disque
    // du container Railway est réinitialisé à chaque redéploiement, donc
    // sans ça la config choisie reviendrait aux valeurs par défaut à chaque
    // push (voir utils/configChannel.js, qui sauvegarde tout ça dans un
    // salon Discord caché partagé avec les autres bots).
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
