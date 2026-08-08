const { PermissionFlagsBits } = require("discord.js");

// Nom du rôle autorisé à utiliser les commandes de modération (préfixe "-").
// Surchargeable via la variable d'environnement MOD_ROLE_NAME.
const MOD_ROLE_NAME = process.env.MOD_ROLE_NAME || "Modérateur";

/**
 * Vérifie si l'auteur du message peut utiliser les commandes de modération.
 * Les administrateurs du serveur sont toujours autorisés.
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
function hasModRole(message) {
  const member = message.member;
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(
    (role) => role.name.toLowerCase() === MOD_ROLE_NAME.toLowerCase()
  );
}

module.exports = { hasModRole, MOD_ROLE_NAME };
