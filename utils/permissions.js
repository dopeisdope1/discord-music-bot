const { PermissionFlagsBits } = require("discord.js");
const { hasCommandAccess } = require("./permissionCategoryStore");

// Utilisées uniquement par hasModPermission/hasBanPermission ci-dessous (une
// heuristique large pour `.help` — "cette section a-t-elle une seule
// commande accessible ?"), PAS par la vérification réelle au moment de
// l'exécution : chaque commande est autorisée indépendamment via
// canUseCommand, catégorie par catégorie (voir `.panel` > Permissions).
const MOD_TIER_COMMANDS = ["renew", "hide", "unhide", "lock", "unlock", "massrole", "panel", "create", "helpall", "perms"];
const BAN_TIER_COMMANDS = ["ban", "unban", "unbanall"];

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
  if (BAN_TIER_COMMANDS.includes(command) && message.member?.permissions.has(PermissionFlagsBits.BanMembers)) return true;
  return hasCommandAccess(message.member, message.guildId, command);
}

/**
 * Heuristique large pour `.help` : true si l'auteur a accès à AU MOINS UNE
 * commande de modération (peu importe laquelle) — sert seulement à décider
 * si la section "Modération" s'affiche. La vérification précise se fait
 * commande par commande via canUseCommand au moment de l'exécution.
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
function hasModPermission(message) {
  if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return MOD_TIER_COMMANDS.some((cmd) => hasCommandAccess(message.member, message.guildId, cmd));
}

/**
 * Même principe que hasModPermission, pour la section "Bannissement" de `.help`.
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
function hasBanPermission(message) {
  if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (message.member?.permissions.has(PermissionFlagsBits.BanMembers)) return true;
  return BAN_TIER_COMMANDS.some((cmd) => hasCommandAccess(message.member, message.guildId, cmd));
}

module.exports = { canUseCommand, hasModPermission, hasBanPermission };
