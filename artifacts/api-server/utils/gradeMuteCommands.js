const { PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkBotPermission } = require("./moderation/actions");
const muteStore = require("./muteStore");
const gradeMuteStore = require("./gradeMuteStore");
const rankLadder = require("./rankLadderCommands");
const listNavigator = require("./listNavigator");
const { carteSanctionMessage, repondreAvecCarte } = require("./actionCard");

// "&bmute"/"&bunmute" — mute bot GRADÉ : un mute posé par quelqu'un au grade
// N (échelle "&promote"/"&demote", voir utils/rankLadderCommands.js) ne peut
// être levé que par un grade AU MOINS égal à N. Distinct de &mute/&unmute
// (utils/moderationExtra.js) : ceux-ci restent inchangés et lèvent le rôle
// sans condition de grade — &bmute est le choix à faire quand ce verrou est
// voulu. Réutilise le même rôle configuré (`set muterole`, utils/
// muteStore.js) pour ne pas exiger un second rôle à créer.
const PERMISSION = "moderation.mutebot";

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

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

/** Libellé d'un index de grade : le rôle de l'échelle à cette position, ou "aucun grade" pour -1. */
function gradeLabel(guild, index) {
  if (index < 0) return "aucun grade";
  const ladder = rankLadder.ladderRoles(guild);
  const roleId = ladder[index];
  return roleId && guild.roles.cache.has(roleId) ? `<@&${roleId}>` : `grade #${index + 1}`;
}

/** "&bmute <@membre> [raison]" — applique le rôle de mute, verrouillé au grade de l'auteur. */
async function bmute(client, message, args) {
  if (!can(message.member, PERMISSION)) return;

  const roleId = muteStore.getMuteRoleId(message.guild.id);
  if (!roleId || !message.guild.roles.cache.has(roleId)) {
    return reply(message, "error", "Aucun rôle de mute configuré — `set muterole @rôle` d'abord.");
  }

  const target = await fetchTargetOrReply(message, parseTarget(args));
  if (!target) return;

  const refusal = checkHierarchy(message.guild, message.member, target);
  if (refusal) return reply(message, "error", refusal);

  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const reason = args.slice(1).join(" ") || null;
  const gradeIndex = rankLadder.currentIndex(message.guild, message.member);

  try {
    await target.roles.add(roleId, `Mute bot par ${message.author.tag}${reason ? ` — ${reason}` : ""}`);
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }

  gradeMuteStore.setMute(message.guild.id, target.id, { gradeIndex, moderatorId: message.author.id, reason });

  const carte = await carteSanctionMessage({
    action: "bmute",
    cible: target,
    moderateur: message.author,
    raison: reason,
    duree: `démute par grade ≥ ${gradeLabel(message.guild, gradeIndex)}`,
    serveur: message.guild.name,
  });
  return repondreAvecCarte(message, carte, () =>
    reply(
      message,
      "success",
      `${target.user.tag} a été mute. Ne pourra être démute que par un grade au moins égal à ${gradeLabel(message.guild, gradeIndex)}.`
    )
  );
}

/** "&bunmute <@membre>" — lève le mute bot, si l'auteur a un grade suffisant. */
async function bunmute(client, message, args) {
  if (!can(message.member, PERMISSION)) return;

  const target = await fetchTargetOrReply(message, parseTarget(args));
  if (!target) return;

  const record = gradeMuteStore.getMute(message.guild.id, target.id);
  if (!record) return reply(message, "info", `${target.user.tag} n'a pas de mute bot actif.`);

  const actorIndex = rankLadder.currentIndex(message.guild, message.member);
  if (actorIndex < record.gradeIndex) {
    return reply(
      message,
      "error",
      `Ce mute a été posé par un grade ${gradeLabel(message.guild, record.gradeIndex)} — seul un grade égal ou supérieur peut le lever.`
    );
  }

  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const roleId = muteStore.getMuteRoleId(message.guild.id);
  try {
    if (roleId) await target.roles.remove(roleId, `Démute bot par ${message.author.tag}`);
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }

  gradeMuteStore.removeMute(message.guild.id, target.id);
  const carte = await carteSanctionMessage({ action: "bunmute", cible: target, moderateur: message.author, serveur: message.guild.name });
  return repondreAvecCarte(message, carte, () => reply(message, "success", `${target.user.tag} a été démute.`));
}

/** "&bmutelist" — mutes bot actifs sur ce serveur, un seul message paginé (voir utils/listNavigator.js). */
async function bmutelist(client, message) {
  if (!can(message.member, PERMISSION)) return;
  return listNavigator.repondreAvecListe("bmutelist", message);
}

listNavigator.registerProvider("bmutelist", (guild) => {
  const entries = gradeMuteStore.list(guild.id);
  return {
    title: "Mutes bot actifs",
    vide: "Aucun mute bot actif sur ce serveur.",
    numerote: true,
    lines: entries.map(
      (e) => `<@${e.userId}> — par <@${e.moderatorId}> — niveau requis pour lever : ${gradeLabel(guild, e.gradeIndex)}`
    ),
  };
});

/** "&bmuteresetall" — lève TOUS les mutes bot du serveur d'un coup. */
async function bmuteresetall(client, message) {
  if (!can(message.member, PERMISSION)) return;

  const entries = gradeMuteStore.list(message.guild.id);
  if (!entries.length) return reply(message, "info", "Aucun mute bot actif à réinitialiser.");

  const roleId = muteStore.getMuteRoleId(message.guild.id);
  let leves = 0;
  for (const entry of entries) {
    if (roleId) {
      const member = await message.guild.members.fetch(entry.userId).catch(() => null);
      if (member) await member.roles.remove(roleId, `Réinitialisation des mutes bot par ${message.author.tag}`).catch(() => {});
    }
    gradeMuteStore.removeMute(message.guild.id, entry.userId);
    leves++;
  }

  return reply(message, "success", `${leves} mute(s) bot levé(s).`);
}

module.exports = { bmute, bunmute, bmutelist, bmuteresetall };
