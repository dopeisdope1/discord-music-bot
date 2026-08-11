require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { handleSecurityTextCommand } = require("./utils/securityCommands");
const { checkBlacklistOnJoin } = require("./utils/blacklistCommands");
const { registerAntiNuke } = require("./utils/antiNuke");
const { buildStatusEmbed } = require("./utils/statusEmbed");
const { loadGuildConfig } = require("./utils/configChannel");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Nécessaire pour lire les commandes textuelles (=antifast, =blacklist,
    // etc.) — à activer manuellement sur le portail développeur Discord
    // (Bot > intents privilégiés).
    GatewayIntentBits.MessageContent,
    // Nécessaire pour guildMemberAdd/guildMemberRemove/guildMemberUpdate
    // (détection anti-nuke, bannissement auto blacklist) et pour que
    // `=allbots`/la détection de modules puissent lister les membres — à
    // activer manuellement sur le portail développeur Discord, comme
    // MESSAGE CONTENT.
    GatewayIntentBits.GuildMembers,
    // Nécessaires pour que l'anti-nuke détecte les bannissements
    // (guildBanAdd), les créations de webhook (webhooksUpdate), les
    // événements planifiés (guildScheduledEvent*) et les déconnexions vocales
    // en masse (voiceStateUpdate) — aucun n'est privilégié, rien à activer
    // sur le portail développeur.
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.GuildVoiceStates,
  ],
  allowedMentions: { parse: ["users"], repliedUser: true },
});

// ---- Commandes textuelles (préfixe fixe "=") ----
client.on("messageCreate", (message) => {
  handleSecurityTextCommand(client, message).catch((err) => {
    console.error(err);
    message
      .reply({ embeds: [buildStatusEmbed("error", "Une erreur est survenue lors du traitement de la commande.")] })
      .catch(() => {});
  });
});

// ---- Protection anti-nuke ("=antifast") ----
registerAntiNuke(client);

// ---- Bannissement automatique d'un membre blacklisté qui rejoint ----
client.on("guildMemberAdd", (member) => {
  checkBlacklistOnJoin(member).catch((err) => console.error("[blacklist] Erreur au join :", err));
});

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    // Restaure la config (logs/antifast/blacklist, + lecture du préfixe
    // modération pour l'affichage dans =logs) : le disque du container
    // Railway est réinitialisé à chaque redéploiement, donc sans ça la
    // config choisie reviendrait aux valeurs par défaut à chaque push (voir
    // utils/configChannel.js, qui sauvegarde tout ça dans un salon Discord
    // caché partagé avec le bot Musique+Modération).
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

// Sans handler, Node.js termine le process instantanément sur SIGTERM (le
// signal que Railway envoie pour arrêter l'ancien conteneur à chaque
// redéploiement), sans attendre la fin des appels réseau en cours — ce qui
// pouvait couper une sauvegarde de config en plein vol. On laisse ici une
// courte marge pour que ces requêtes Discord en cours aient le temps de se
// terminer avant de fermer nous-mêmes proprement.
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
