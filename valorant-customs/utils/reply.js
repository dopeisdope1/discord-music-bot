/**
 * Réponses aux commandes préfixe.
 *
 * Toujours en réponse au message d'origine, jamais de ping de l'auteur : le
 * salon reste lisible même quand plusieurs personnes enchaînent les commandes.
 */

const { errorEmbed, successEmbed, infoEmbed } = require("./embeds");

const send = (message, embed) =>
  message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } })
    .catch((error) => console.error("[reply] Réponse impossible :", error.message));

const replyError = (message, text) => send(message, errorEmbed(text));
const replyOk = (message, text) => send(message, successEmbed(text));
const replyInfo = (message, text) => send(message, infoEmbed(text));

module.exports = { replyError, replyOk, replyInfo };
