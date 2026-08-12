const { PermissionFlagsBits } = require("discord.js");
const { isBotOwner } = require("./botOwners");
const { buildStatusEmbed } = require("./statusEmbed");
const { getLastChannel, setLastChannel } = require("./sayDmStore");

// `&say` fonctionne UNIQUEMENT en message privé au bot, jamais dans un salon
// : contrairement à un message envoyé puis supprimé, Discord diffuse tout
// message de salon en direct à tout le monde AVANT même que le bot ne
// reçoive l'événement — la suppression qui suit arrive toujours trop tard
// pour empêcher un flash visible (constaté deux fois : "ils voient tjr quand
// jecrit"). En DM, ton compte ne poste jamais rien dans le salon visé : rien
// à cacher, rien à supprimer, zéro fenêtre d'exposition.
const MESSAGE_LINK_REGEX = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)$/;
const SAY_PREFIX = "&say";
const DISCORD_MESSAGE_LIMIT = 2000;

function usageEmbed() {
  return buildStatusEmbed(
    "error",
    "Utilisation en DM : `&say <lien du message ou ID du salon> <texte>`\n" +
      "> Colle un lien de message (clic droit sur le message > **Copier le lien**) pour répondre à ce message précis.\n" +
      "> Ou juste l'ID d'un salon pour y envoyer un message normal (clic droit sur le salon > **Copier l'ID**).\n" +
      "> Le texte peut tenir sur plusieurs lignes.\n" +
      "> Une fois un salon donné une première fois, il est retenu : `&say <texte>` suffit ensuite pour y renvoyer (sans réponse à un message précis)."
  );
}

/**
 * Découpe un texte trop long pour la limite Discord (2000 caractères) en
 * plusieurs morceaux, en coupant sur un retour à la ligne ou un espace
 * plutôt qu'en plein milieu d'un mot quand c'est possible.
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoChunks(text) {
  if (text.length <= DISCORD_MESSAGE_LIMIT) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > DISCORD_MESSAGE_LIMIT) {
    let cut = remaining.lastIndexOf("\n", DISCORD_MESSAGE_LIMIT);
    if (cut <= 0) cut = remaining.lastIndexOf(" ", DISCORD_MESSAGE_LIMIT);
    if (cut <= 0) cut = DISCORD_MESSAGE_LIMIT;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\s+/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
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

  // Ne sépare que le premier "mot" (lien/ID de salon, s'il y en a un) : le
  // reste est gardé tel quel (retours à la ligne, espaces multiples...) au
  // lieu d'être aplati par un split/join sur tous les espaces, qui
  // détruisait le texte sur plusieurs lignes.
  const rest = message.content.slice(SAY_PREFIX.length).trim();
  if (!rest) return message.reply({ embeds: [usageEmbed()] });

  const splitMatch = rest.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  const firstToken = splitMatch[1];
  const afterFirstToken = splitMatch[2]?.trim();
  const linkMatch = firstToken.match(MESSAGE_LINK_REGEX);
  const looksLikeSelector = Boolean(linkMatch) || /^\d{15,}$/.test(firstToken);

  let channelId;
  let messageId;
  let text;

  if (looksLikeSelector) {
    // Salon/lien explicitement donné : on l'utilise, et on le retient pour
    // la prochaine fois — plus besoin de le recopier à chaque `&say`.
    if (!afterFirstToken) return message.reply({ embeds: [usageEmbed()] });
    if (linkMatch) {
      [, channelId, messageId] = linkMatch;
    } else {
      channelId = firstToken;
    }
    text = afterFirstToken;
  } else {
    // Pas de salon/lien reconnaissable en premier : on suppose que tout
    // "rest" est le texte, et on réutilise le dernier salon enregistré.
    channelId = getLastChannel(message.author.id);
    text = rest;
    if (!channelId) {
      return message.reply({
        embeds: [
          buildStatusEmbed(
            "error",
            "Aucun salon enregistré pour l'instant — précise-le une première fois avec `&say <lien ou ID de salon> <texte>`."
          ),
        ],
      });
    }
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !channel.guild) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Salon introuvable ou inaccessible.")] });
  }

  const botPermissions = channel.guild.members.me?.permissionsIn(channel);
  if (!botPermissions?.has(PermissionFlagsBits.SendMessages)) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Je n'ai pas la permission d'écrire dans ce salon.")] });
  }

  // Ne retient que les salons donnés explicitement et validés (existants,
  // accessibles) — pas la peine de re-sauvegarder si on vient déjà de le
  // relire depuis le store.
  if (looksLikeSelector) setLastChannel(message.author.id, channelId);

  const target = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
  if (messageId && !target) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Message introuvable (lien invalide, ou message supprimé).")] });
  }

  const chunks = splitIntoChunks(text);
  try {
    for (let i = 0; i < chunks.length; i++) {
      const payload = { content: chunks[i], allowedMentions: { parse: [] } };
      if (i === 0 && target) {
        await target.reply(payload);
      } else {
        await channel.send(payload);
      }
    }
    await message.reply({ embeds: [buildStatusEmbed("success", `Envoyé dans ${channel} sur **${channel.guild.name}**${chunks.length > 1 ? ` (${chunks.length} messages)` : ""}.`)] });
  } catch (err) {
    console.error("[sayDm] Échec de l'envoi :", err);
    await message.reply({ embeds: [buildStatusEmbed("error", "Échec de l'envoi.")] });
  }
}

module.exports = { handleSayDirectMessage };
