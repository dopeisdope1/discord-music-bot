const { PermissionFlagsBits } = require("discord.js");
const { hasRoleAccess } = require("./commandPermissionStore");
const { getMemberTier, tierHasCommand } = require("./permTierStore");

// Permission Discord native "Bannir des membres" acceptée en plus
// d'Administrateur, mais uniquement pour ces commandes précises.
const BAN_NATIVE_BYPASS_COMMANDS = ["ban", "unban", "unbanall"];

/**
 * Vérifie si l'auteur peut utiliser une commande précise : administrateur,
 * permission Discord native **Bannir des membres** pour les commandes de ban
 * (`.ban`/`.unban`/`.unbanall`) uniquement, un rôle explicitement autorisé
 * pour cette commande via `.panel`/`?panel` > Permissions (voir
 * utils/commandPermissionStore.js), ou un rôle dont le palier (voir
 * utils/permTierStore.js — `&perms`) débloque cette commande. Les deux
 * systèmes de rôles restent indépendants (pas de fusion des données), cette
 * fonction se contente de vérifier les deux. Fonctionne aussi bien avec un
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
  if (hasRoleAccess(message.member, message.guildId, command)) return true;
  if (message.member) {
    const tier = getMemberTier(message.guildId, message.member);
    if (tier && tierHasCommand(message.guildId, tier, command)) return true;
  }
  return false;
}

module.exports = { canUseCommand };
