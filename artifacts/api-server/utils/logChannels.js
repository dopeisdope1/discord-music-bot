const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { getAllLogChannels, setLogChannelId } = require("./modLogStore");

// Création/suppression automatique des salons de logs. Extrait
// d'utils/configPanel.js pour que &autoconfiglog (utils/logCommands.js) appelle
// EXACTEMENT la même chose que le bouton du panel, plutôt qu'une seconde
// version qui divergerait au premier ajustement.

const LOG_CHANNEL_NAMES = {
  moderation: "logs-moderation",
  members: "logs-membres",
  roles: "logs-roles",
  channels: "logs-salons",
  voice: "logs-vocal",
  server: "logs-serveur",
  bots: "logs-bots",
  messages: "logs-messages",
};

/**
 * Crée un salon par catégorie de logs qui n'en a pas encore (ou dont le
 * salon configuré a été supprimé) — regroupés dans une catégorie "Logs"
 * (réutilisée si elle existe déjà). Chaque salon est masqué à @everyone :
 * la permission Discord Administrateur passe outre les restrictions de
 * salon, donc seuls les administrateurs le voient, sans rien à configurer
 * de plus. Idempotent : ne recrée jamais un salon pour une catégorie déjà
 * configurée avec un salon qui existe encore.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ created: { category: string, channel: import('discord.js').TextChannel }[] }>}
 */
async function createLogChannelsAutomatically(guild) {
  const everyone = guild.roles.everyone;
  const existing = getAllLogChannels(guild.id);

  const missing = Object.keys(LOG_CHANNEL_NAMES).filter((category) => {
    const channelId = existing[category];
    return !channelId || !guild.channels.cache.has(channelId);
  });
  if (!missing.length) return { created: [] };

  const hiddenFromEveryone = [{ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];

  let parent = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === "Logs");
  if (!parent) {
    parent = await guild.channels.create({
      name: "Logs",
      type: ChannelType.GuildCategory,
      permissionOverwrites: hiddenFromEveryone,
      reason: "Création automatique des salons de logs (&panel > Logs)",
    });
  }

  const created = [];
  for (const category of missing) {
    const channel = await guild.channels.create({
      name: LOG_CHANNEL_NAMES[category],
      type: ChannelType.GuildText,
      parent: parent.id,
      permissionOverwrites: hiddenFromEveryone,
      reason: "Création automatique des salons de logs (&panel > Logs)",
    });
    setLogChannelId(guild.id, category, channel.id);
    created.push({ category, channel });
  }
  return { created };
}

/**
 * Supprime tous les salons de logs actuellement configurés (et existants)
 * puis vide leur configuration — le bouton "Créer les salons
 * automatiquement" les recrée ensuite tous à neuf, catégorie de logs
 * réinitialisée entièrement.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ deleted: string[] }>} catégories dont le salon a été supprimé
 */
async function deleteLogChannelsAutomatically(guild) {
  const existing = getAllLogChannels(guild.id);
  const deleted = [];
  for (const [category, channelId] of Object.entries(existing)) {
    if (!channelId) continue;
    const channel = guild.channels.cache.get(channelId);
    if (channel) await channel.delete("Suppression des salons de logs (&panel > Logs)").catch(() => {});
    setLogChannelId(guild.id, category, null);
    deleted.push(category);
  }
  return { deleted };
}

module.exports = { LOG_CHANNEL_NAMES, createLogChannelsAutomatically, deleteLogChannelsAutomatically };
