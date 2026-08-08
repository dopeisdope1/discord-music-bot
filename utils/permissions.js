const { PermissionFlagsBits } = require("discord.js");
const { getGuildSettings } = require("./guildSettings");

// Nom du rôle autorisé à utiliser les commandes de modération (préfixe "-"),
// utilisé tant qu'aucun rôle n'a été configuré via /modconfig.
// Surchargeable via la variable d'environnement MOD_ROLE_NAME.
const MOD_ROLE_NAME = process.env.MOD_ROLE_NAME || "Modérateur";

/**
 * Vérifie si l'auteur du message peut utiliser les commandes de modération.
 * Les administrateurs du serveur sont toujours autorisés. Utilise les rôles
 * configurés via /modconfig s'il y en a, sinon se rabat sur MOD_ROLE_NAME.
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
function hasModRole(message) {
  const member = message.member;
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  const { modRoleIds } = getGuildSettings(message.guildId);
  if (modRoleIds && modRoleIds.length > 0) {
    return member.roles.cache.some((role) => modRoleIds.includes(role.id));
  }
  return member.roles.cache.some((role) => role.name.toLowerCase() === MOD_ROLE_NAME.toLowerCase());
}

module.exports = { hasModRole, MOD_ROLE_NAME };
