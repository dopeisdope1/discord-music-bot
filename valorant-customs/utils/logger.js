/**
 * Logs d'activité dans un salon dédié (LOG_CHANNEL_ID).
 * Totalement optionnel : sans salon configuré, on ne loggue qu'en console.
 */

const { EmbedBuilder } = require("discord.js");
const config = require("../config");

const EVENTS = {
  create:  { emoji: "🆕", color: config.colors.base,    label: "Partie créée" },
  join:    { emoji: "✅", color: config.colors.success, label: "Joueur inscrit" },
  leave:   { emoji: "↩️", color: config.colors.waiting, label: "Joueur parti" },
  warn:    { emoji: "⚠️", color: config.colors.warn,    label: "Avertissement" },
  kick:    { emoji: "⛔", color: config.colors.error,   label: "Joueur retiré" },
  promote: { emoji: "🎟️", color: config.colors.success, label: "Place attribuée" },
  start:   { emoji: "▶️", color: config.colors.live,    label: "Partie lancée" },
  end:     { emoji: "🛑", color: config.colors.ended,   label: "Partie terminée" },
  voice:   { emoji: "🔊", color: config.colors.base,    label: "Salons vocaux" },
};

/**
 * @param {import('discord.js').Client} client
 * @param {string} type clé de EVENTS
 * @param {{matchId?: string, description: string, fields?: {name: string, value: string}[]}} payload
 */
async function logEvent(client, type, payload) {
  const meta = EVENTS[type] || { emoji: "•", color: config.colors.base, label: type };
  const line = `[${meta.label}]${payload.matchId ? ` #${payload.matchId}` : ""} ${payload.description.replace(/\n/g, " ")}`;
  console.log(line);

  if (!config.logChannelId) return;
  try {
    const channel = await client.channels.fetch(config.logChannelId);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setAuthor({ name: `${meta.emoji} ${meta.label}` })
      .setDescription(payload.description)
      .setTimestamp();
    if (payload.matchId) embed.setFooter({ text: `Partie #${payload.matchId}` });
    if (payload.fields?.length) embed.addFields(payload.fields);

    // Aucun ping depuis les logs : les mentions restent lisibles mais muettes.
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error("[logger] Envoi du log impossible :", error.message);
  }
}

module.exports = { logEvent };
