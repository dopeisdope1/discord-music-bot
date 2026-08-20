const { EmbedBuilder } = require("discord.js");

/**
 * Construit un embed de statut sobre : pas de couleur, pas d'icône, juste le
 * texte. Le paramètre `type` ne change plus le rendu (conservé pour ne pas
 * avoir à retoucher tous les appels) ; `options.icon` est ignoré.
 * @param {"success"|"error"|"info"|"warning"} type
 * @param {string} description
 * @param {{ title?: string, thumbnail?: string, image?: string, fields?: {name: string, value: string, inline?: boolean}[] }} [options]
 * @returns {EmbedBuilder}
 */
function buildStatusEmbed(type, description, options = {}) {
  const embed = new EmbedBuilder();
  if (description) embed.setDescription(description);
  if (options.title) embed.setTitle(options.title);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (options.fields?.length) embed.addFields(options.fields);
  return embed;
}

module.exports = { buildStatusEmbed };
