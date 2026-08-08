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

/**
 * Vérifie si l'auteur du message peut utiliser -ban : administrateurs, ou
 * membres ayant la permission Discord native **Bannir des membres** (un cran
 * en dessous d'Administrateur, gérée par les admins du serveur eux-mêmes via
 * les rôles Discord — donc sans passer par le système -panel).
 * @param {import('discord.js').Message} message
 * @returns {boolean}
 */
function hasBanPermission(message) {
  return Boolean(
    message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
      message.member?.permissions.has(PermissionFlagsBits.BanMembers)
  );
}

module.exports = { hasModPermission, hasBanPermission };
