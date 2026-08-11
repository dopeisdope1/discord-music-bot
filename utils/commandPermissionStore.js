const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. La liste est aussi sauvegardée dans le salon Discord
// partagé "zinki-config" (voir utils/configChannel.js), qui lui survit aux
// redéploiements.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "commandPermissions.json");

// Commandes qu'un administrateur peut déléguer à un rôle depuis `.panel`/
// `?panel` > Permissions. Volontairement exclues : `panel` (accès à la
// config elle-même) et `banall` (trop destructrice, voir
// utils/moderationCommands.js — déjà soumise à l'autorisation du
// propriétaire).
const DELEGABLE_COMMANDS = [
  "clear",
  "renew",
  "hide",
  "unhide",
  "lock",
  "unlock",
  "massrole",
  "create",
  "ban",
  "unban",
  "unbanall",
  "warn",
  "warns",
  "delwarn",
  "mute",
  "unmute",
  "unmuteall",
  "tempban",
  "kick",
  "derank",
  "slowmode",
];

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[commandPermissionStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @returns {{ [command: string]: string[] }} commande -> IDs de rôles autorisés
 */
function getAllGrants(guildId) {
  const data = load();
  return { ...(data[guildId] || {}) };
}

/**
 * @param {string} guildId
 * @param {string} command
 * @returns {string[]} IDs de rôles autorisés pour cette commande
 */
function getRolesForCommand(guildId, command) {
  return getAllGrants(guildId)[command] || [];
}

/**
 * Remplace la liste complète des rôles autorisés pour une commande (même
 * logique qu'un RoleSelectMenu multi-valeurs : l'ensemble choisi remplace
 * l'ensemble précédent).
 * @param {string} guildId
 * @param {string} command
 * @param {string[]} roleIds
 */
function setRolesForCommand(guildId, command, roleIds) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][command] = [...roleIds];
  save();
}

/**
 * @param {import('discord.js').GuildMember|null|undefined} member
 * @param {string} guildId
 * @param {string} command
 * @returns {boolean} true si un des rôles du membre est autorisé pour cette commande
 */
function hasRoleAccess(member, guildId, command) {
  if (!member) return false;
  const roleIds = getRolesForCommand(guildId, command);
  if (roleIds.length === 0) return false;
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * Valeurs brutes d'un serveur, utilisé par utils/configChannel.js pour
 * sauvegarder/restaurer via Discord.
 * @param {string} guildId
 */
function getRawGuildData(guildId) {
  return load()[guildId] || {};
}

/**
 * Recharge les permissions d'un serveur depuis une source externe (voir
 * utils/configChannel.js — la config sauvegardée dans un salon Discord
 * dédié, qui survit aux redéploiements Railway contrairement au disque local).
 * @param {string} guildId
 * @param {object} remoteData
 */
function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = { ...data[guildId], ...remoteData };
  save();
}

module.exports = {
  DELEGABLE_COMMANDS,
  getAllGrants,
  getRolesForCommand,
  setRolesForCommand,
  hasRoleAccess,
  getRawGuildData,
  hydrateFromRemote,
};
