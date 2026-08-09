const { buildStatusEmbed } = require("./statusEmbed");
const { getLogChannelId } = require("./logStore");

/**
 * Envoie un message dans le salon de logs configuré pour cette catégorie
 * (voir `.panel` > Logs). Ne fait rien si aucun salon n'est configuré ou si
 * le bot ne peut pas y écrire.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {"moderation"|"salon"|"roles"} category
 * @param {string} description
 */
async function sendLog(client, guildId, category, description) {
  const channelId = getLogChannelId(guildId, category);
  if (!channelId) return;
  const channel = client.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [buildStatusEmbed("info", description)] }).catch(() => {});
}

module.exports = { sendLog };
