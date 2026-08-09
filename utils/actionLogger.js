const { EmbedBuilder } = require("discord.js");
const { getLogChannelId, LOG_CATEGORIES } = require("./logStore");

/**
 * Envoie un embed structuré dans le salon de logs configuré pour cette
 * catégorie (voir `.panel` > Logs). Ne fait rien si aucun salon n'est
 * configuré ou si le bot ne peut pas y écrire.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {"moderation"|"salon"|"roles"} category
 * @param {object} entry
 * @param {string} entry.title — action loguée (ex: "Clear", "Ban", "Massrole — ajout")
 * @param {string} entry.description — résumé en une phrase
 * @param {import('discord.js').User} [entry.actor] — auteur de l'action (affiché en haut avec son avatar)
 * @param {{ name: string, value: string, inline?: boolean }[]} [entry.fields]
 */
async function sendLog(client, guildId, category, { title, description, actor, fields } = {}) {
  const channelId = getLogChannelId(guildId, category);
  if (!channelId) return;
  const channel = client.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const meta = LOG_CATEGORIES[category];
  const embed = new EmbedBuilder()
    .setColor(meta?.color ?? 0x2b2d31)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

  if (actor) {
    embed.setAuthor({ name: actor.tag, iconURL: actor.displayAvatarURL() });
  }
  if (fields?.length) {
    embed.addFields(fields);
  }
  if (meta) {
    embed.setFooter({ text: meta.label });
  }

  await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { sendLog };
