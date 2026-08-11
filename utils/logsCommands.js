const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { handleLogsCommand } = require("./logsPanel");
const { buildHelpPanel } = require("./helpPanels");
const { getPrefixes } = require("./prefixStore");
const { waitForHydration, saveGuildConfig } = require("./configChannel");
const { getLogChannels, setLogChannel, LOG_CATEGORIES } = require("./logStore");
const { isOwner } = require("./antiNukeStore");
const { buildStatusEmbed } = require("./statusEmbed");

function buildLogsHelpPanel(prefix) {
  return buildHelpPanel({
    title: "Aide — Bot Logs",
    intro: `Préfixe : \`${prefix}\``,
    sections: [
      {
        heading: "Logs",
        lines: [
          `\`${prefix}logs\` — Choisit le salon de destination par catégorie`,
          `\`${prefix}autologs\` — Crée et configure d'un coup tous les salons de logs manquants`,
        ],
      },
    ],
    footer: "Réservé aux owners anti-nuke de ce serveur (voir `=owner` sur le bot Antifast).",
  });
}

// Crée une catégorie "📁 Logs" avec un salon par catégorie de logs pas encore
// configurée (voir utils/logStore.js) — évite d'avoir à faire `=logs` +
// créer chaque salon à la main un par un pour un nouveau serveur.
async function autologs(client, message) {
  if (!isOwner(message.guild, message.author.id)) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke de ce serveur (voir `=owner`).")] });
  }
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les salons**.")] });
  }

  const existing = getLogChannels(message.guild.id);
  const missing = Object.values(LOG_CATEGORIES).filter((cat) => !existing[cat.key]);
  if (!missing.length) {
    return message.reply({ embeds: [buildStatusEmbed("info", "Toutes les catégories de logs sont déjà configurées.")] });
  }

  const category = await message.guild.channels
    .create({ name: "📁 Logs", type: ChannelType.GuildCategory, reason: `Autologs par ${message.author.tag}` })
    .catch(() => null);

  let created = 0;
  for (const cat of missing) {
    const channel = await message.guild.channels
      .create({
        name: cat.key,
        type: ChannelType.GuildText,
        parent: category?.id,
        permissionOverwrites: [{ id: message.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
        reason: `Autologs par ${message.author.tag}`,
      })
      .catch(() => null);
    if (!channel) continue;
    setLogChannel(message.guild.id, cat.key, channel.id);
    created += 1;
  }
  await saveGuildConfig(message.guild, ["logChannels"]);
  await message.reply({ embeds: [buildStatusEmbed("success", `**${created}** salon(s) de logs créé(s) et configuré(s).`)] });
}

const handlers = {
  help: (client, message, args, prefix) => message.channel.send(buildLogsHelpPanel(prefix)),
  logs: (client, message) => handleLogsCommand(message),
  autologs: (client, message) => autologs(client, message),
};

/**
 * À appeler dans l'écouteur "messageCreate" du bot Logs. Le préfixe est
 * configurable par serveur via `.panel` (bot Musique+Modération) — voir
 * utils/prefixStore.js/prefixPanel.js.
 */
async function handleLogsTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  // Si le bot vient de redémarrer, attend que le préfixe ait fini d'être
  // restauré depuis Discord avant de le lire (voir utils/configChannel.js).
  await waitForHydration(message.guild.id);

  const content = message.content.trim();
  const { logs: LOGS_PREFIX } = getPrefixes(message.guild.id);
  if (!content.startsWith(LOGS_PREFIX)) return;

  const [cmdRaw, ...args] = content.slice(LOGS_PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  if (!handlers[cmd]) return;

  return handlers[cmd](client, message, args, LOGS_PREFIX);
}

module.exports = { handleLogsTextCommand };
