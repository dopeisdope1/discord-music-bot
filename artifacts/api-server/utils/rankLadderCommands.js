const { PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkBotPermission } = require("./moderation/actions");
const ladderStore = require("./rankLadderStore");
const gradeLadderPanel = require("./gradeLadderPanel");

// "&promote"/"&demote" — échelle de grades ordonnée (utils/rankLadderStore.js),
// SÉPARÉE de "&rank" (utils/levels.js, niveaux/XP) et "&derank" (utils/
// moderationExtra.js, retire TOUS les rôles) : ces deux mots existaient déjà
// pour autre chose, l'échelle de grades utilise donc son propre vocabulaire.
const PERMISSION = "members.rank.manage";

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

/** Cible = PREMIER argument exactement (mention ou ID) — même règle que &kick/&derank. */
function parseTarget(args) {
  const mention = args[0]?.match(/^<@!?(\d{15,25})>$/);
  const id = args[0]?.match(/^\d{15,25}$/);
  return mention?.[1] || id?.[0] || null;
}

async function fetchTargetOrReply(message, targetId) {
  if (!targetId) {
    await reply(message, "error", "Indique un membre (mention ou identifiant).");
    return null;
  }
  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    await reply(message, "error", "Ce membre n'est pas sur le serveur.");
    return null;
  }
  return target;
}

/** Rôles de l'échelle qui existent ENCORE sur le serveur, dans l'ordre (bas -> haut) — un rôle supprimé ailleurs ne casse pas l'échelle, il disparaît juste du calcul. */
function ladderRoles(guild) {
  return ladderStore.getLadder(guild.id).filter((id) => guild.roles.cache.has(id));
}

/** Index le plus haut de l'échelle que porte ce membre, -1 si aucun grade. */
function currentIndex(guild, member) {
  const ladder = ladderRoles(guild);
  let idx = -1;
  for (let i = 0; i < ladder.length; i++) {
    if (member.roles.cache.has(ladder[i])) idx = i;
  }
  return idx;
}

async function moveGrade(message, args, direction) {
  if (!can(message.member, PERMISSION)) return;
  const ladder = ladderRoles(message.guild);
  if (!ladder.length) {
    return reply(message, "error", "Aucune échelle de grades configurée — `gradeladder add @rôle` (du plus bas au plus haut).");
  }

  const target = await fetchTargetOrReply(message, parseTarget(args));
  if (!target) return;

  const refusal = checkHierarchy(message.guild, message.member, target);
  if (refusal) return reply(message, "error", refusal);

  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const idx = currentIndex(message.guild, target);
  const nextIdx = idx + direction;

  if (direction > 0 && idx >= ladder.length - 1) {
    return reply(message, "info", `${target.user.tag} est déjà au grade le plus haut.`);
  }
  if (direction < 0 && idx <= 0) {
    return reply(
      message,
      "info",
      idx === -1 ? `${target.user.tag} n'a aucun grade sur l'échelle.` : `${target.user.tag} est déjà au grade le plus bas.`
    );
  }

  const nextRole = message.guild.roles.cache.get(ladder[nextIdx]);
  if (!nextRole) return reply(message, "error", "Le rôle du grade suivant n'existe plus — vérifie `gradeladder list`.");

  const me = message.guild.members.me;
  if (me.roles.highest.position <= nextRole.position) {
    return reply(message, "error", "Mon rôle est trop bas pour gérer ce grade — place-le plus haut dans la liste des rôles.");
  }

  const raison = `${direction > 0 ? "Promotion" : "Rétrogradation"} par ${message.author.tag}`;
  try {
    if (idx !== -1) await target.roles.remove(ladder[idx], raison);
    await target.roles.add(nextRole, raison);
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }

  return reply(message, "success", `${target.user.tag} est maintenant **${nextRole.name}**.`);
}

async function promote(client, message, args) {
  return moveGrade(message, args, 1);
}

async function demote(client, message, args) {
  return moveGrade(message, args, -1);
}

/** "&gradeladder <add|remove|list> [@rôle]" — configure l'échelle elle-même. */
async function gradeLadder(client, message, args) {
  if (!can(message.member, PERMISSION)) return;
  const sub = (args[0] || "").toLowerCase();

  if (sub === "list" || !sub) {
    return gradeLadderPanel.repondreAvecGradeLadder(message);
  }

  const roleArg = (args[1] || "").replace(/\D/g, "");
  const role = message.mentions.roles?.first() || (roleArg ? message.guild.roles.cache.get(roleArg) : null);
  if (!role) return reply(message, "error", "Indique un rôle (mention ou identifiant) : `gradeladder <add|remove> @rôle`.");

  if (sub === "add") {
    if (!ladderStore.addRole(message.guild.id, role.id)) return reply(message, "info", `${role} est déjà dans l'échelle.`);
    return reply(message, "success", `${role} ajouté à l'échelle, au grade le plus haut.`);
  }
  if (sub === "remove") {
    if (!ladderStore.removeRole(message.guild.id, role.id)) return reply(message, "info", `${role} n'est pas dans l'échelle.`);
    return reply(message, "success", `${role} retiré de l'échelle.`);
  }
  return reply(message, "error", "Utilise : `gradeladder <add|remove|list> [@rôle]`.");
}

module.exports = { promote, demote, gradeLadder, ladderRoles, currentIndex };
