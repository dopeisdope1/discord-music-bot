const { EmbedBuilder } = require("discord.js");

/**
 * Construit un embed de statut sobre : pas de couleur, pas d'icône, juste le
 * texte. Le paramètre `type` ne change plus le rendu (conservé pour ne pas
 * avoir à retoucher tous les appels) ; `options.icon` est ignoré.
 * @param {"success"|"error"|"info"|"warning"} type
 * @param {string} description
 * @param {{ title?: string, thumbnail?: string }} [options]
 * @returns {EmbedBuilder}
 */
function buildStatusEmbed(type, description, options = {}) {
  const embed = new EmbedBuilder().setDescription(description);
  if (options.title) embed.setTitle(options.title);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  return embed;
}

module.exports = { buildStatusEmbed };
