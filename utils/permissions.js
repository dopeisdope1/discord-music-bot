const { PermissionFlagsBits } = require("discord.js");
const { memberHasAllowedRole } = require("./rolePermStore");

/**
 * Vérifie si l'auteur du message peut utiliser les commandes de modération.
 * Administrateurs, ou membres ayant un rôle autorisé via `.panel` > Permissions
 * (groupe "mod" — voir utils/rolePermStore.js).
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
function hasModPermission(message) {
  return Boolean(
    message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
      memberHasAllowedRole(message.member, "mod")
  );
}

/**
 * Vérifie si l'auteur du message peut utiliser -ban : administrateurs,
 * membres ayant la permission Discord native **Bannir des membres**, ou
 * membres ayant un rôle autorisé via `.panel` > Permissions (groupe "ban").
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
function hasBanPermission(message) {
  return Boolean(
    message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
      message.member?.permissions.has(PermissionFlagsBits.BanMembers) ||
      memberHasAllowedRole(message.member, "ban")
  );
}

module.exports = { hasModPermission, hasBanPermission };
