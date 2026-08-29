/**
 * Qui a le droit de faire quoi sur une partie.
 * Règle simple : l'hôte gère SA partie, le staff gère toutes les parties.
 */

const { PermissionFlagsBits } = require("discord.js");
const config = require("../config");

function isHost(match, userId) {
  return match.hostId === userId;
}

/** Admin Discord (Gérer le serveur / Modérer) ou porteur du rôle staff configuré. */
function isStaff(member) {
  if (!member) return false;
  if (config.staffRoleId && member.roles?.cache?.has(config.staffRoleId)) return true;
  return Boolean(
    member.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions?.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

/** Droit de gérer la partie : lancer, terminer, avertir, kick, move... */
function canManage(match, member) {
  return isHost(match, member?.id) || isStaff(member);
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
