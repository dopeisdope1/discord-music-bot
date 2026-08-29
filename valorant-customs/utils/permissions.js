/**
 * Qui a le droit de faire quoi sur une partie.
 *
 * L'hôte gère SA partie. Gèrent TOUTES les parties :
 *   - le staff du serveur (admins Discord ou rôle STAFF_ROLE_ID) ;
 *   - les propriétaires et gestionnaires du bot, nommés depuis le panneau
 *     (voir utils/access.js).
 */

const { PermissionFlagsBits } = require("discord.js");
const settings = require("./settings");
const access = require("./access");

function isHost(match, userId) {
  return match.hostId === userId;
}

/** Admin Discord (Gérer le serveur / Modérer) ou porteur du rôle staff configuré. */
function isStaff(member) {
  if (!member) return false;
  if (settings.get("staffRoleId") && member.roles?.cache?.has(settings.get("staffRoleId"))) return true;
  return Boolean(
    member.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions?.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

/** Droit de gérer la partie : lancer, terminer, avertir, kick, move... */
function canManage(match, member) {
  if (!member) return false;
  return isHost(match, member.id) || access.isManager(member.id) || isStaff(member);
}

/**
 * Permissions dont le bot a besoin pour créer et gérer les salons vocaux
 * d'équipe. Vérifiées au lancement de la partie pour donner un message
 * d'erreur clair plutôt qu'un échec silencieux.
 */
const REQUIRED_BOT_PERMISSIONS = [
  { flag: PermissionFlagsBits.ManageChannels, label: "Gérer les salons" },
  { flag: PermissionFlagsBits.MoveMembers, label: "Déplacer des membres" },
  { flag: PermissionFlagsBits.ViewChannel, label: "Voir les salons" },
];

/** @returns {string[]} la liste des permissions manquantes (vide si tout va bien). */
function missingBotPermissions(guild) {
  const me = guild.members.me;
  if (!me) return ["Impossible de lire les permissions du bot"];
  return REQUIRED_BOT_PERMISSIONS.filter((perm) => !me.permissions.has(perm.flag)).map((perm) => perm.label);
}

module.exports = { isHost, isStaff, canManage, missingBotPermissions };
