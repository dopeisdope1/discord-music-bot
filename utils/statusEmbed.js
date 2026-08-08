const { EmbedBuilder } = require("discord.js");

const STATUS_STYLES = {
  success: { color: 0x1db954, icon: "✅" },
  error: { color: 0xed4245, icon: "❌" },
  info: { color: 0x5865f2, icon: "ℹ️" },
  warning: { color: 0xfaa61a, icon: "⚠️" },
};

/**
 * Construit un embed de statut cohérent (couleur + icône selon le type).
 * @param {"success"|"error"|"info"|"warning"} type
 * @param {string} description
 * @param {{ icon?: string, title?: string }} [options]
 * @returns {EmbedBuilder}
 */
function buildStatusEmbed(type, description, options = {}) {
  const style = STATUS_STYLES[type] || STATUS_STYLES.info;
  const icon = options.icon ?? style.icon;
  const embed = new EmbedBuilder().setColor(style.color).setDescription(`${icon} ${description}`);
  if (options.title) embed.setTitle(options.title);
  return embed;
}

module.exports = { buildStatusEmbed };
