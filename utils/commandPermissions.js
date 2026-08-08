const { PermissionFlagsBits } = require("discord.js");
const { getCommandConfig } = require("./commandConfigStore");

// Commandes "-" ouvertes à tout le monde par défaut, tant qu'aucune règle
// spécifique n'a été configurée via -panel.
const DEFAULT_OPEN_COMMANDS = new Set(["pic", "avatar", "snipe"]);

/**
 * Détermine si l'auteur du message peut utiliser une commande "-", en tenant
 * compte des règles configurées via -panel (rôles autorisés/interdits, salons
 * autorisés). Les administrateurs du serveur ont toujours accès à tout.
 * @param {import('discord.js').Message} message
 * @param {string} command
 * @returns {{ allowed: boolean, reason?: "channel"|"denied-role"|"not-allowed" }}
 */
function canUseDashCommand(message, command) {
  const member = message.member;
  if (!member) return { allowed: false };
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return { allowed: true };

  const config = getCommandConfig(message.guildId, command);

  if (config.allowedChannelIds?.length && !config.allowedChannelIds.includes(message.channelId)) {
    return { allowed: false, reason: "channel" };
  }

  const roleIds = member.roles.cache.map((r) => r.id);

  if (config.deniedRoleIds?.some((id) => roleIds.includes(id))) {
    return { allowed: false, reason: "denied-role" };
  }

  if (config.allowedRoleIds?.length) {
    return roleIds.some((id) => config.allowedRoleIds.includes(id))
      ? { allowed: true }
      : { allowed: false, reason: "not-allowed" };
  }

  return DEFAULT_OPEN_COMMANDS.has(command) ? { allowed: true } : { allowed: false, reason: "not-allowed" };
}

module.exports = { canUseDashCommand, DEFAULT_OPEN_COMMANDS };
