const { buildStatusEmbed } = require("./statusEmbed");
const {
  isEnabled,
  setEnabled,
  isOwner,
  isBotOwner,
  getOwners,
  addOwner,
  removeOwner,
  getWhitelist,
  addToWhitelist,
  removeFromWhitelist,
} = require("./antiNukeStore");
const { saveGuildConfig } = require("./configChannel");
const { sendLog } = require("./actionLogger");

function resolveMemberArg(guild, raw) {
  if (!raw) return null;
  const id = raw.replace(/[<@!>]/g, "");
  return /^\d{15,}$/.test(id) ? id : null;
}

/**
 * `.antifast [on|off]` — active/désactive l'anti-nuke pour ce serveur (voir
 * utils/antiNuke.js), ou affiche l'état actuel sans argument. Réservé aux
 * "owners" anti-nuke (voir isOwner) — jamais délégable via `.panel` >
 * Permissions comme les autres commandes, pour ne pas pouvoir être désactivé
 * par un compte admin compromis.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleAntifastCommand(message, args) {
  if (!isOwner(message.guild, message.author.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke (voir `.owner`).")],
    });
  }

  const sub = (args[0] || "").toLowerCase();
  if (!sub) {
    const state = isEnabled(message.guild.id) ? "activé ✅" : "désactivé ❌";
    return message.reply({ embeds: [buildStatusEmbed("info", `Anti-nuke actuellement **${state}**.`)] });
  }

  if (sub !== "on" && sub !== "off") {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Utilisation : `.antifast` (statut), `.antifast on` ou `.antifast off`.")],
    });
  }

  setEnabled(message.guild.id, sub === "on");
  await saveGuildConfig(message.guild);
  sendLog(message.client, message.guild.id, "securite", {
    title: sub === "on" ? "Anti-nuke activé" : "Anti-nuke désactivé",
    description: `Anti-nuke ${sub === "on" ? "activé" : "désactivé"} via \`.antifast ${sub}\`.`,
    actor: message.author,
  });
  await message.reply({
    embeds: [buildStatusEmbed("success", `Anti-nuke **${sub === "on" ? "activé ✅" : "désactivé ❌"}**.`)],
  });
}

/**
 * `.owner add|remove|list [@membre]` — gère qui, en plus du vrai propriétaire
 * Discord du serveur, peut configurer l'anti-nuke (`.antifast`, `.wl`).
 * Volontairement réservé au propriétaire réel (`guild.ownerId`) ou à un
 * propriétaire du BOT (`BOT_OWNER_IDS`, valable sur tous les serveurs) —
 * jamais aux owners anti-nuke ajoutés via cette commande eux-mêmes, sinon un
 * owner ajouté par erreur (ou compromis) pourrait en ajouter d'autres en
 * chaîne.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleOwnerCommand(message, args) {
  if (message.author.id !== message.guild.ownerId && !isBotOwner(message.author.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Réservé au propriétaire du serveur (ou du bot).")],
    });
  }

  const sub = (args[0] || "").toLowerCase();

  if (sub === "list" || !sub) {
    const owners = getOwners(message.guild.id);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          owners.length ? owners.map((id) => `<@${id}>`).join(", ") : "Aucun owner ajouté (juste toi, le propriétaire).",
          { title: "Owners anti-nuke" }
        ),
      ],
    });
  }

  if (sub !== "add" && sub !== "remove") {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Utilisation : `.owner add @membre`, `.owner remove @membre` ou `.owner list`.")],
    });
  }

  const targetId = resolveMemberArg(message.guild, args[1]);
  if (!targetId) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Mentionne un membre ou donne son ID.")] });
  }

  if (sub === "add") {
    addOwner(message.guild.id, targetId);
    await saveGuildConfig(message.guild);
    sendLog(message.client, message.guild.id, "securite", {
      title: "Owner anti-nuke ajouté",
      description: `<@${targetId}> ajouté aux owners anti-nuke via \`.owner add\`.`,
      actor: message.author,
    });
    return message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> est maintenant owner anti-nuke.`)] });
  }

  removeOwner(message.guild.id, targetId);
  await saveGuildConfig(message.guild);
  sendLog(message.client, message.guild.id, "securite", {
    title: "Owner anti-nuke retiré",
    description: `<@${targetId}> retiré des owners anti-nuke via \`.owner remove\`.`,
    actor: message.author,
  });
  await message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> n'est plus owner anti-nuke.`)] });
}

/**
 * `.wl add|remove|list [@membre]` — liste des membres exemptés des
 * déclencheurs anti-nuke (en plus du propriétaire, des owners et du bot).
 * Gérée par les owners anti-nuke (voir isOwner), contrairement à `.owner`
 * qui reste au seul vrai propriétaire.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleWhitelistCommand(message, args) {
  if (!isOwner(message.guild, message.author.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke (voir `.owner`).")],
    });
  }

  const sub = (args[0] || "").toLowerCase();

  if (sub === "list" || !sub) {
    const whitelist = getWhitelist(message.guild.id);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          whitelist.length ? whitelist.map((id) => `<@${id}>`).join(", ") : "Personne sur la whitelist.",
          { title: "Whitelist anti-nuke" }
        ),
      ],
    });
  }

  if (sub !== "add" && sub !== "remove") {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Utilisation : `.wl add @membre`, `.wl remove @membre` ou `.wl list`.")],
    });
  }

  const targetId = resolveMemberArg(message.guild, args[1]);
  if (!targetId) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Mentionne un membre ou donne son ID.")] });
  }

  if (sub === "add") {
    addToWhitelist(message.guild.id, targetId);
    await saveGuildConfig(message.guild);
    sendLog(message.client, message.guild.id, "securite", {
      title: "Whitelist anti-nuke — ajout",
      description: `<@${targetId}> ajouté à la whitelist anti-nuke via \`.wl add\`.`,
      actor: message.author,
    });
    return message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> ajouté à la whitelist anti-nuke.`)] });
  }

  removeFromWhitelist(message.guild.id, targetId);
  await saveGuildConfig(message.guild);
  sendLog(message.client, message.guild.id, "securite", {
    title: "Whitelist anti-nuke — retrait",
    description: `<@${targetId}> retiré de la whitelist anti-nuke via \`.wl remove\`.`,
    actor: message.author,
  });
  await message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> retiré de la whitelist anti-nuke.`)] });
}

module.exports = { handleAntifastCommand, handleOwnerCommand, handleWhitelistCommand };
