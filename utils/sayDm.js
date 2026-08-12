const { PermissionFlagsBits } = require("discord.js");
const { isBotOwner } = require("./botOwners");
const { buildStatusEmbed } = require("./statusEmbed");

// `&say` fonctionne UNIQUEMENT en message privé au bot, jamais dans un salon
// : contrairement à un message envoyé puis supprimé, Discord diffuse tout
// message de salon en direct à tout le monde AVANT même que le bot ne
// reçoive l'événement — la suppression qui suit arrive toujours trop tard
// pour empêcher un flash visible (constaté deux fois : "ils voient tjr quand
// jecrit"). En DM, ton compte ne poste jamais rien dans le salon visé : rien
// à cacher, rien à supprimer, zéro fenêtre d'exposition.
const MESSAGE_LINK_REGEX = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)$/;
const SAY_PREFIX = "&say";

function usageEmbed() {
  return buildStatusEmbed(
    "error",
    "Utilisation en DM : `&say <lien du message ou ID du salon> <texte>`\n" +
      "> Colle un lien de message (clic droit sur le message > **Copier le lien**) pour répondre à ce message précis.\n" +
      "> Ou juste l'ID d'un salon pour y envoyer un message normal (clic droit sur le salon > **Copier l'ID**)."
  );
}

/**
 * À appeler dans l'écouteur "messageCreate" pour les DM au bot (voir
 * index.js) — remplace l'ancien `&say` de salon. Réservé au(x)
 * propriétaire(s) du bot (BOT_OWNER_IDS, voir utils/botOwners.js) ; ignoré
 * silencieusement pour tout le monde en DM (pas de fuite d'info sur
 * l'existence de la commande à qui n'y a pas droit).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 */
async function handleSayDirectMessage(client, message) {
  if (message.author.bot || message.guild) return;
  if (!message.content.trim().toLowerCase().startsWith(SAY_PREFIX)) return;
  if (!isBotOwner(message.author.id)) return;

  const rest = message.content.trim().slice(SAY_PREFIX.length).trim();
  const [firstArg, ...textParts] = rest.split(/\s+/);
  const text = textParts.join(" ").trim();

  if (!firstArg || !text) {
    return message.reply({ embeds: [usageEmbed()] });
  }

  let channelId;
  let messageId;
  const linkMatch = firstArg.match(MESSAGE_LINK_REGEX);
  if (linkMatch) {
    [, channelId, messageId] = linkMatch;
  } else if (/^\d{15,}$/.test(firstArg)) {
    channelId = firstArg;
  } else {
    return message.reply({ embeds: [usageEmbed()] });
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !channel.guild) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Salon introuvable ou inaccessible.")] });
  }

  const botPermissions = channel.guild.members.me?.permissionsIn(channel);
  if (!botPermissions?.has(PermissionFlagsBits.SendMessages)) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Je n'ai pas la permission d'écrire dans ce salon.")] });
  }

  const target = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
  if (messageId && !target) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Message introuvable (lien invalide, ou message supprimé).")] });
  }

  const payload = { content: text, allowedMentions: { parse: [] } };
  try {
    if (target) {
      await target.reply(payload);
    } else {
      await channel.send(payload);
    }
    await message.reply({ embeds: [buildStatusEmbed("success", `Envoyé dans ${channel} sur **${channel.guild.name}**.`)] });
  } catch (err) {
    console.error("[sayDm] Échec de l'envoi :", err);
    await message.reply({ embeds: [buildStatusEmbed("error", "Échec de l'envoi.")] });
  }
}

module.exports = { handleSayDirectMessage };
