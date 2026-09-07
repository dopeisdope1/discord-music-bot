const { EmbedBuilder } = require("discord.js");
const { EMOJI } = require("./emojis");

// Toujours pas de couleur ni de vignette (choix conservé) : juste un emoji
// custom du serveur au tout début du texte, selon `type`. "warning" réutilise
// l'emoji info — les deux seuls appels avec ce type (sélection/demande
// expirée) sont de simples avis, pas des échecs.
const TYPE_EMOJI = {
  success: EMOJI.SUCCESS,
  error: EMOJI.ERROR,
  info: EMOJI.INFO,
  warning: EMOJI.INFO,
};

/**
 * Construit un embed de statut : pas de couleur ni de vignette, juste le
 * texte précédé d'un emoji selon `type`. `options.icon` reste ignoré (aucun
 * appelant ne le renseigne).
 * @param {"success"|"error"|"info"|"warning"} type
 * @param {string} description
 * @param {{ title?: string, thumbnail?: string, image?: string, fields?: {name: string, value: string, inline?: boolean}[] }} [options]
 * @returns {EmbedBuilder}
 */
function buildStatusEmbed(type, description, options = {}) {
  const embed = new EmbedBuilder();
  const emoji = TYPE_EMOJI[type];
  if (description) embed.setDescription(emoji ? `${emoji} ${description}` : description);
  if (options.title) embed.setTitle(options.title);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (options.fields?.length) embed.addFields(options.fields);
  return embed;
}

module.exports = { buildStatusEmbed };
