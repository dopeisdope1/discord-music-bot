const { sendLog } = require("./actionLogger");
const { buildStatusEmbed } = require("./statusEmbed");
const { validateMassRoleTarget } = require("./massRole");

async function resolveMemberArg(guild, raw) {
  if (!raw) return null;
  const id = raw.replace(/[<@!>]/g, "");
  if (!/^\d{15,}$/.test(id)) return null;
  return guild.members.fetch(id).catch(() => null);
}

async function resolveRoleArg(guild, raw) {
  if (!raw) return null;
  const id = raw.replace(/[<@&>]/g, "");
  if (!/^\d{15,}$/.test(id)) return null;
  return guild.roles.fetch(id).catch(() => null);
}

/**
 * `add <rôle>` (en réponse à un message, ou avec le membre déjà résolu) —
 * équivalent direct, sans panel.
 * @param {import('discord.js').Message} message
 * @param {string} memberArg
 * @param {string} roleArg
 */
async function addRoleDirect(message, memberArg, roleArg) {
  const member = await resolveMemberArg(message.guild, memberArg);
  const role = await resolveRoleArg(message.guild, roleArg);
  if (!member || !role) return;

  const invalidReason = validateMassRoleTarget(message.guild, role);
  if (invalidReason) {
    return message.reply({ embeds: [buildStatusEmbed("error", invalidReason)] });
  }
  if (member.roles.cache.has(role.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("info", `**${member.user.tag}** a déjà le rôle **${role.name}**.`)],
    });
  }

  const added = await member.roles
    .add(role, `Ajouté via "add" par ${message.author.tag}`)
    .then(() => true)
    .catch((err) => {
      console.error(err);
      return false;
    });

  if (!added) {
    return message.reply({
      embeds: [buildStatusEmbed("error", `Impossible d'ajouter **${role.name}** à **${member.user.tag}** (erreur Discord).`)],
    });
  }

  sendLog(message.client, message.guild.id, "roles", {
    title: "Ajout de rôle",
    description: `Rôle **${role.name}** ajouté à <@${member.id}>.`,
    actor: message.author,
  });
  await message.reply({ embeds: [buildStatusEmbed("success", `Rôle **${role.name}** ajouté à **${member.user.tag}**.`)] });
}

/**
 * `del <rôle>` — équivalent direct de addRoleDirect, pour le retrait.
 * @param {import('discord.js').Message} message
 * @param {string} memberArg
 * @param {string} roleArg
 */
async function delRoleDirect(message, memberArg, roleArg) {
  const member = await resolveMemberArg(message.guild, memberArg);
  const role = await resolveRoleArg(message.guild, roleArg);
  if (!member || !role) return;

  const invalidReason = validateMassRoleTarget(message.guild, role);
  if (invalidReason) {
    return message.reply({ embeds: [buildStatusEmbed("error", invalidReason)] });
  }
  if (!member.roles.cache.has(role.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("info", `**${member.user.tag}** n'a pas le rôle **${role.name}**.`)],
    });
  }

  const removed = await member.roles
    .remove(role, `Retiré via "del" par ${message.author.tag}`)
    .then(() => true)
    .catch((err) => {
      console.error(err);
      return false;
    });

  if (!removed) {
    return message.reply({
      embeds: [buildStatusEmbed("error", `Impossible de retirer **${role.name}** à **${member.user.tag}** (erreur Discord).`)],
    });
  }

  sendLog(message.client, message.guild.id, "roles", {
    title: "Retrait de rôle",
    description: `Rôle **${role.name}** retiré de <@${member.id}>.`,
    actor: message.author,
  });
  await message.reply({ embeds: [buildStatusEmbed("success", `Rôle **${role.name}** retiré de **${member.user.tag}**.`)] });
}

module.exports = { resolveMemberArg, resolveRoleArg, addRoleDirect, delRoleDirect };
