const accessStore = require("../accessStore");
const { postModerationEntry } = require("../moderationLog");
const historyStore = require("../moderationHistoryStore");

/**
 * Motifs de refus indépendants de qui lance l'action ET de la permission
 * Discord requise (vérifiée séparément par chaque commande via
 * checkBotPermission, avec SON flag à elle — kick n'a pas besoin de
 * "Bannir des membres", etc.) : protections du propriétaire du serveur/du
 * bot, rang sys, hiérarchie du bot lui-même. Base commune à toute action de
 * modération ciblant un membre. Exportée pour utils/banPanel.js, qui s'en
 * sert pour son propre `refusalReason` (banAll.js l'applique en masse, sans
 * "acteur" précis) — garder ces règles à un seul endroit plutôt que
 * dupliquées entre les deux fichiers.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember} target
 * @returns {string|null}
 */
function botAndRankRefusal(guild, target) {
  const me = guild.members.me;
  if (target.id === guild.ownerId) return "Impossible d'agir sur le propriétaire du serveur.";
  if (target.id === me.id) return "Je ne peux pas agir sur moi-même.";
  if (accessStore.isOwner(target.id)) return "Ce membre est propriétaire du bot.";
  if (accessStore.isAllowed("sys", target.id)) return "Ce membre a le rang sys, retire-le lui d'abord.";
  if (me.roles.highest.position <= target.roles.highest.position) {
    return "Mon rôle est trop bas pour agir sur ce membre — place-le plus haut dans la liste des rôles.";
  }
  return null;
}

/**
 * Hiérarchie complète pour une action ciblant UN membre précis : reprend
 * botAndRankRefusal ci-dessus, puis ajoute la vérification qui manquait pour
 * les commandes désormais accordées par rôle — un modérateur ne doit jamais
 * agir sur quelqu'un dont le rôle est supérieur ou égal au sien (section 33
 * du cahier des charges). Le propriétaire du serveur et du bot passent outre
 * cette dernière règle.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember} actor qui lance la commande
 * @param {import('discord.js').GuildMember} target
 * @returns {string|null} motif du refus, ou null si l'action est possible
 */
function checkHierarchy(guild, actor, target) {
  if (target.id === actor.id) return "Tu ne peux pas agir sur toi-même.";

  const botRefusal = botAndRankRefusal(guild, target);
  if (botRefusal) return botRefusal;

  if (actor.id === guild.ownerId || accessStore.isOwner(actor.id)) return null;

  if (actor.roles.highest.position <= target.roles.highest.position) {
    return "Tu ne peux pas agir sur un membre dont le rôle est supérieur ou égal au tien.";
  }
  return null;
}

const PERMISSION_LABELS = {
  BanMembers: "Bannir des membres",
  KickMembers: "Expulser des membres",
  ModerateMembers: "Rendre muet des membres (timeout)",
  ManageRoles: "Gérer les rôles",
  ManageChannels: "Gérer les salons",
  ManageNicknames: "Gérer les pseudos",
  ManageMessages: "Gérer les messages",
};

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').PermissionsBitField} flag ex: PermissionFlagsBits.BanMembers
 * @param {string} flagName clé lisible dans PERMISSION_LABELS, pour un message clair
 * @returns {string|null} motif du refus, ou null si le bot a la permission
 */
function checkBotPermission(guild, flag, flagName) {
  if (guild.members.me.permissions.has(flag)) return null;
  return `Il me manque la permission **${PERMISSION_LABELS[flagName] || flagName}**.`;
}

/**
 * Journalise une action de modération effectuée par CE bot : salon de logs
 * (utils/moderationLog.js::postModerationEntry) + historique consultable
 * (utils/moderationHistoryStore.js). Point d'écriture UNIQUE pour toute
 * commande de modération de ce bot — le modérateur enregistré est toujours
 * la vraie personne qui a tapé la commande (jamais le compte du bot, voir
 * l'explication dans utils/moderationLog.js).
 *
 * `fields` ne porte que ce qui est spécifique à l'action (ex: "Cible",
 * "Durée") — Auteur et Raison sont ajoutés automatiquement par
 * postModerationEntry, pas la peine de les répéter à chaque appel.
 * @param {import('discord.js').Client} client
 * @param {object} params
 * @param {string} params.guildId
 * @param {"moderation"|"members"|"server"} params.category
 * @param {string} params.title ex: "Expulsion", "Timeout"
 * @param {{label: string, value: string}[]} params.fields
 * @param {string} params.action ex: "ban", "kick", "timeout", "clear"...
 * @param {string} params.targetId
 * @param {string|null} [params.targetTag]
 * @param {import('discord.js').User} params.moderator
 * @param {string|null} [params.reason]
 * @param {string|null} [params.channelId]
 * @param {object|null} [params.extra]
 */
async function report(client, params) {
  const { guildId, category, title, fields, action, targetId, targetTag, moderator, reason, channelId, extra } = params;

  await postModerationEntry(client, guildId, category, {
    title,
    fields,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag,
    reason,
  });

  historyStore.record({
    guildId,
    action,
    targetId,
    targetTag: targetTag || null,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag,
    reason: reason || null,
    channelId: channelId || null,
    source: "bot",
    extra: extra || null,
  });
}

module.exports = { checkHierarchy, botAndRankRefusal, checkBotPermission, report };
