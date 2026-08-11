require("dotenv").config();
const path = require("path");
const { Client, GatewayIntentBits, Collection, PermissionFlagsBits, AuditLogEvent } = require("discord.js");
const { handleModerationTextCommand, rememberSnipe } = require("./utils/moderationCommands");
const { buildStatusEmbed } = require("./utils/statusEmbed");
const { randomWelcomeMessage } = require("./utils/welcomeMessages");
const { getLogChannelId } = require("./utils/logStore");
const { sendLog } = require("./utils/actionLogger");
const { loadGuildConfig } = require("./utils/configChannel");

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

// Stocke le dernier message supprimé par salon (commande .snipe)
client.snipes = new Collection();

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

// ---- Message de bienvenue pour les nouveaux membres ----
client.on("guildMemberAdd", (member) => {
  console.log(`[bienvenue] Nouveau membre : ${member.user.tag} sur "${member.guild.name}"`);
  const botMember = member.guild.members.me;
  const channel =
    member.guild.channels.cache.find((c) => c.isTextBased() && c.name.toLowerCase() === "vé") ||
    member.guild.systemChannel ||
    member.guild.channels.cache.find(
      (c) => c.isTextBased() && !c.isThread() && c.permissionsFor(botMember)?.has(PermissionFlagsBits.SendMessages)
    );
  if (!channel) {
    console.warn("[bienvenue] Aucun salon disponible pour envoyer le message.");
    return;
  }
  console.log(`[bienvenue] Envoi dans #${channel.name}`);
  channel
    .send(`${member} ${randomWelcomeMessage()}`)
    .catch((err) => console.error("[bienvenue] Échec de l'envoi :", err));
});

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
