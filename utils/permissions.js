const { PermissionFlagsBits } = require("discord.js");

/**
 * Vérifie si l'auteur du message peut utiliser les commandes de modération.
 * Réservé aux administrateurs du serveur.
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
function hasModPermission(message) {
  return Boolean(message.member?.permissions.has(PermissionFlagsBits.Administrator));
}

module.exports = { hasModPermission };
