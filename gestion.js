require("dotenv").config();
const path = require("path");
const { Client, GatewayIntentBits, Collection, AuditLogEvent } = require("discord.js");
const { handleModerationTextCommand, rememberSnipe, rememberEditSnipe, endGiveaway } = require("./utils/moderationCommands");
const { buildStatusEmbed } = require("./utils/statusEmbed");
const { getLogChannelId } = require("./utils/logStore");
const { sendLog } = require("./utils/actionLogger");
const { loadGuildConfig } = require("./utils/configChannel");
const { getAllTempBans, removeTempBan } = require("./utils/tempBanStore");
const { getAllReminders, removeReminder } = require("./utils/reminderStore");
const { getAllActiveGiveaways } = require("./utils/giveawayStore");
const { startVoiceHub } = require("./utils/voiceHubBot");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Nécessaire pour lire les commandes textuelles (.clear, .ban, etc.) — à
    // activer manuellement sur le portail développeur Discord (Bot > intents
    // privilégiés).
    GatewayIntentBits.MessageContent,
    // Nécessaire pour recevoir guildMemberAdd/guildMemberUpdate (message de
    // bienvenue, log des changements de rôle manuels) et pour que
    // `.banall`/`.massrole` puissent lister tous les membres du serveur — à
    // activer manuellement sur le portail développeur Discord, comme
    // MESSAGE CONTENT.
    GatewayIntentBits.GuildMembers,
  ],
  // Empêche tout ping accidentel de @everyone/@here/rôles (ex: message sniped
  // contenant littéralement "@everyone"). Les mentions d'utilisateurs restent
  // autorisées.
  allowedMentions: { parse: ["users"], repliedUser: true },
});

// ---- Chargement des commandes slash de modération uniquement ----
const MODERATION_COMMAND_FILES = ["ban.js", "unban.js"];
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
for (const file of MODERATION_COMMAND_FILES) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// Stocke le dernier message supprimé/édité par salon (commandes .snipe/.editsnipe)
client.snipes = new Collection();
client.editSnipes = new Collection();

// ---- Interactions : slash commands (les boutons/menus/modales de .panel,
// .ban, .unban, etc. sont gérés par leurs propres collectors attachés au
// message, voir utils/prefixPanel.js et utils/banPanel.js — pas ici) ----
client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      console.error(err);
    }
    return;
  }

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
  }
});

// ---- Commandes textuelles préfixées (. par défaut, configurable via .panel) ----
client.on("messageCreate", (message) => {
  handleModerationTextCommand(client, message).catch((err) => {
    console.error(err);
    message
      .reply({ embeds: [buildStatusEmbed("error", "Une erreur est survenue lors du traitement de la commande.")] })
      .catch(() => {});
  });
});

// ---- Mémorise les messages supprimés pour la commande .snipe ----
client.on("messageDelete", (message) => {
  if (!message.guild) return;
  rememberSnipe(client, message.channelId, message, "deleted");
});

// ---- Mémorise les messages édités pour la commande .editsnipe ----
client.on("messageUpdate", (oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  rememberEditSnipe(client, newMessage.channelId, oldMessage, newMessage);
});

// ---- Logue les changements de rôle faits "à la main" (via le profil du membre
// ou le menu de rôles Discord natif), dans la catégorie "Logs rôles" (voir
// =logs sur le bot Logs). Les changements faits PAR le bot (.massrole ou le
// raccourci add/del) sont déjà logués par leurs propres handlers — on les
// ignore ici (exécuteur = le bot dans les logs d'audit Discord) pour éviter
// un doublon.
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (!getLogChannelId(newMember.guild.id, "roles")) return;

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;
  const added = newRoles.filter((r) => !oldRoles.has(r.id));
  const removed = oldRoles.filter((r) => !newRoles.has(r.id));
  if (added.size === 0 && removed.size === 0) return;

  let executor = null;
  try {
    const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 5 });
    executor = auditLogs.entries.find(
      (entry) => entry.target?.id === newMember.id && Date.now() - entry.createdTimestamp < 10_000
    )?.executor;
  } catch (err) {
    console.warn("[logs] Impossible de lire les logs d'audit pour ce changement de rôle :", err.message);
  }

  if (executor?.id === client.user.id) return;

  const fields = [{ name: "Membre", value: `${newMember.user.tag} (${newMember.id})`, inline: false }];
  if (added.size) fields.push({ name: "Ajoutés", value: added.map((r) => r.toString()).join(", "), inline: true });
  if (removed.size) fields.push({ name: "Retirés", value: removed.map((r) => r.toString()).join(", "), inline: true });

  sendLog(client, newMember.guild.id, "roles", {
    title: "Rôle modifié (manuel)",
    description: executor
      ? "Changement de rôle effectué à la main."
      : "Changement de rôle effectué à la main (exécuteur inconnu — active **View Audit Log** pour l'attribution).",
    actor: executor ?? undefined,
    fields,
  });
});

// Note : l'envoi du message de bienvenue à l'arrivée d'un membre est géré
// par le bot Musique (voir index.js) — son intent "Server Members" est
// confirmé actif depuis le début de la session. `.setbienvenue`/
// `.addbienvenue`/etc. restent disponibles ici (config partagée via
// utils/welcomeStore.js), seul l'envoi effectif est ailleurs.

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    // Restaure les préfixes/salons de logs configurés via .panel : le disque
    // du container Railway est réinitialisé à chaque redéploiement, donc sans
    // ça la config choisie reviendrait aux valeurs par défaut à chaque push
    // (voir utils/configChannel.js, qui sauvegarde tout ça dans un salon
    // Discord caché — jamais réinitialisé, lui).
    loadGuildConfig(guild).catch((err) => {
      console.warn(`⚠️ Impossible de restaurer la config du serveur "${guild.name}":`, err.message);
    });
  }
});

// Fait la même chose quand le bot rejoint un nouveau serveur en cours de route.
client.on("guildCreate", (guild) => {
  loadGuildConfig(guild).catch((err) => {
    console.warn(`⚠️ Impossible de restaurer la config du serveur "${guild.name}":`, err.message);
  });
});

// ---- Débannissement automatique des bannissements temporaires (.tempban)
// arrivés à expiration — vérifié chaque minute plutôt qu'avec un setTimeout
// par bannissement (qui ne survivrait pas à un redéploiement Railway).
setInterval(async () => {
  for (const { guildId, userId, expiresAt } of getAllTempBans()) {
    if (Date.now() < expiresAt) continue;
    const guild = client.guilds.cache.get(guildId);
    removeTempBan(guildId, userId);
    if (!guild) continue;
    try {
      await guild.bans.remove(userId, "Ban temporaire expiré");
      sendLog(client, guildId, "moderation", {
        title: "Ban temporaire expiré",
        description: `<@${userId}> (\`${userId}\`) a été débanni automatiquement.`,
      });
    } catch (err) {
      // Déjà débanni manuellement entretemps, ou permission manquante — pas
      // grave, l'entrée est de toute façon retirée du store ci-dessus.
      console.warn(`[tempban] Impossible de débannir ${userId} sur ${guildId} :`, err.message);
    }
  }
}, 60_000);

// ---- Envoi des rappels arrivés à échéance (.reminder) — même logique de
// vérification périodique que les bans temporaires ci-dessus.
setInterval(() => {
  for (const reminder of getAllReminders()) {
    if (Date.now() < reminder.dueAt) continue;
    removeReminder(reminder.guildId, reminder.id);
    const channel = client.channels.cache.get(reminder.channelId);
    if (!channel) continue;
    channel
      .send({
        content: `<@${reminder.userId}>`,
        embeds: [buildStatusEmbed("info", reminder.text, { title: "⏰ Rappel" })],
      })
      .catch(() => {});
  }
}, 60_000);

// ---- Tirage au sort automatique des giveaways arrivés à échéance
// (.giveaway) — même logique de vérification périodique que ci-dessus.
setInterval(async () => {
  for (const giveaway of getAllActiveGiveaways()) {
    if (Date.now() < giveaway.endAt) continue;
    await endGiveaway(client, giveaway.guildId, giveaway.id).catch((err) =>
      console.warn(`[giveaway] Impossible de terminer le giveaway #${giveaway.id} sur ${giveaway.guildId} :`, err.message)
    );
  }
}, 60_000);

// Sans handler, Node.js termine le process instantanément sur SIGTERM (le
// signal que Railway envoie pour arrêter l'ancien conteneur à chaque
// redéploiement), sans attendre la fin des appels réseau en cours — ce qui
// pouvait couper une sauvegarde de config (ex: préfixe tout juste changé via
// .panel, voir utils/configChannel.js) en plein vol si un push tombait juste
// après, faisant revenir la config à l'ancienne valeur au redémarrage.
// Enregistrer ce handler désactive la fermeture automatique de Node : on
// laisse ici une courte marge pour que ces requêtes Discord en cours aient le
// temps de se terminer avant de fermer nous-mêmes proprement.
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

// ---- Bot Voice-Hub : seconde identité Discord dans ce même process (voir
// utils/voiceHubBot.js) — évite un 5e service Railway.
startVoiceHub();
