const { PermissionFlagsBits } = require("discord.js");
const { hasCommandAccess } = require("./permissionCategoryStore");

// Permission Discord native "Bannir des membres" acceptée en plus des
// catégories de permission, mais uniquement pour ces commandes précises.
const BAN_NATIVE_BYPASS_COMMANDS = ["ban", "unban", "unbanall"];

/**
 * Vérifie si l'auteur peut utiliser une commande précise : administrateur,
 * permission Discord native **Bannir des membres** pour les commandes de ban
 * (`.ban`/`.unban`/`.unbanall`), ou rôle autorisé pour une catégorie de
 * permission qui inclut cette commande (voir `.panel` > Permissions,
 * utils/permissionCategoryStore.js — chaque catégorie est indépendante,
 * aucun héritage automatique entre elles). Fonctionne aussi bien avec un
 * Message (commandes texte) qu'une interaction de commande slash (les deux
 * exposent `.member` et `.guildId`).
 * @param {import('discord.js').Message|import('discord.js').ChatInputCommandInteraction} message
 * @param {string} command
 * @returns {boolean}
 */
function canUseCommand(message, command) {
  if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (BAN_NATIVE_BYPASS_COMMANDS.includes(command) && message.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
    return true;
  }
  return hasCommandAccess(message.member, message.guildId, command);
}

module.exports = { canUseCommand };
