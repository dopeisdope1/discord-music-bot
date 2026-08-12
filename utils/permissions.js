const { PermissionFlagsBits } = require("discord.js");
const { hasRoleAccess } = require("./commandPermissionStore");
const { getMemberTier, tierHasCommand } = require("./permTierStore");
const { isBotOwner } = require("./botOwners");

// Permission Discord native "Bannir des membres" acceptée en plus
// d'Administrateur, mais uniquement pour ces commandes précises.
const BAN_NATIVE_BYPASS_COMMANDS = ["ban", "unban", "unbanall"];

// Commandes qui court-circuitent TOUT le reste (même Administrateur natif) :
// réservées au(x) propriétaire(s) du bot (BOT_OWNER_IDS, voir
// utils/botOwners.js) — demande explicite : "&panel que par moi".
const BOT_OWNER_ONLY_COMMANDS = ["panel"];

/**
 * Vérifie si l'auteur peut utiliser une commande précise : propriétaire du
 * bot uniquement pour BOT_OWNER_ONLY_COMMANDS (même un administrateur du
 * serveur n'y a pas accès), sinon administrateur, permission Discord native
 * **Bannir des membres** pour les commandes de ban (`.ban`/`.unban`/
 * `.unbanall`) uniquement, un rôle explicitement autorisé pour cette
 * commande via `&panel` > Permissions (voir utils/commandPermissionStore.js),
 * ou un rôle dont le palier (voir utils/permTierStore.js — `&perms`)
 * débloque cette commande. Les deux systèmes de rôles restent indépendants
 * (pas de fusion des données), cette fonction se contente de vérifier les
 * deux. Fonctionne aussi bien avec un Message (commandes texte) qu'une
 * interaction de commande slash (les deux exposent `.member`/`.guildId`, et
 * `.author`/`.user` pour l'ID de l'appelant).
 * @param {import('discord.js').Message|import('discord.js').ChatInputCommandInteraction} message
 * @param {string} command
 * @returns {boolean}
 */
function canUseCommand(message, command) {
  if (BOT_OWNER_ONLY_COMMANDS.includes(command)) {
    const userId = message.author?.id || message.user?.id;
    return Boolean(userId && isBotOwner(userId));
  }
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
