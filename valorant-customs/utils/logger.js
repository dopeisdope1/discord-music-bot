/**
 * Logs d'activité dans un salon dédié (LOG_CHANNEL_ID).
 * Totalement optionnel : sans salon configuré, on ne loggue qu'en console.
 */

const { EmbedBuilder } = require("discord.js");
const config = require("../config");
const settings = require("./settings");

/**
 * Types d'événements.
 *
 * `important: true` = conservé même quand le niveau de logs est réglé sur
 * « essentiel » depuis le panneau. Le reste (inscriptions, départs…) devient
 * vite bavard sur un serveur actif.
 */
const EVENTS = {
  create:  { emoji: "🆕", color: config.colors.base,    label: "Partie créée",       important: true },
  join:    { emoji: "✅", color: config.colors.success, label: "Joueur inscrit" },
  leave:   { emoji: "↩️", color: config.colors.waiting, label: "Joueur parti" },
  warn:    { emoji: "⚠️", color: config.colors.warn,    label: "Avertissement",      important: true },
  kick:    { emoji: "⛔", color: config.colors.error,   label: "Joueur retiré",      important: true },
  promote: { emoji: "🎟️", color: config.colors.success, label: "Place attribuée",    important: true },
  start:   { emoji: "▶️", color: config.colors.live,    label: "Partie lancée",      important: true },
  end:     { emoji: "🛑", color: config.colors.ended,   label: "Partie terminée",    important: true },
  voice:   { emoji: "🔊", color: config.colors.base,    label: "Salons vocaux" },
  balance: { emoji: "⚖️", color: config.colors.base,    label: "Équilibrage" },
  rank:    { emoji: "🏆", color: config.colors.base,    label: "Rang / compte Riot" },
  access:  { emoji: "🔑", color: config.colors.live,    label: "Accès au bot",       important: true },
  config:  { emoji: "⚙️", color: config.colors.base,    label: "Configuration",      important: true },
  error:   { emoji: "🔴", color: config.colors.error,   label: "Erreur",             important: true },
};

/**
 * @param {import('discord.js').Client} client
 * @param {string} type clé de EVENTS
 * @param {{matchId?: string, description: string, fields?: {name: string, value: string}[]}} payload
 */
async function logEvent(client, type, payload) {
  const meta = EVENTS[type] || { emoji: "•", color: config.colors.base, label: type, important: true };
  const line = `[${meta.label}]${payload.matchId ? ` #${payload.matchId}` : ""} ${payload.description.replace(/\n/g, " ")}`;
  // La console reçoit TOUT, quels que soient les réglages : c'est le journal
  // de bord de l'hébergeur, il ne doit jamais être amputé.
  console.log(line);

  if (!settings.get("logsEnabled")) return;
  if (settings.get("logLevel") === "important" && !meta.important) return;
  if (!settings.get("logChannelId")) return;
  try {
    const channel = await client.channels.fetch(settings.get("logChannelId"));
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

module.exports = { logEvent, EVENTS };
