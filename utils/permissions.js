const { PermissionFlagsBits } = require("discord.js");

// Permission Discord native "Bannir des membres" acceptée en plus
// d'Administrateur, mais uniquement pour ces commandes précises.
const BAN_NATIVE_BYPASS_COMMANDS = ["ban", "unban", "unbanall"];

/**
 * Vérifie si l'auteur peut utiliser une commande précise : administrateur,
 * ou permission Discord native **Bannir des membres** pour les commandes de
 * ban (`.ban`/`.unban`/`.unbanall`) uniquement. Fonctionne aussi bien avec un
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
  return false;
}

module.exports = { canUseCommand };
