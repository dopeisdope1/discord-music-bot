const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. Pointer DATA_DIR vers un Volume Railway monté (persistant,
// lui, entre les redéploiements) rend ce fichier permanent. Voir le README.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "rolePerms.json");

// Groupes affichés dans `.panel` > Permissions, alignés sur les vérifications
// de utils/permissions.js. Les rôles ajoutés ici s'ajoutent aux permissions
// Discord natives (Administrateur, Bannir des membres) — ils ne les remplacent
// jamais.
const PERMISSION_GROUPS = {
  mod: {
    key: "mod",
    label: "Commandes modération",
    description: "`.renew`, `.hide`, `.unhide`, `.lock`, `.unlock`, `.massrole`, `.panel`, `.create`, `.clear` (sur un autre membre ou un nombre)",
  },
  ban: {
    key: "ban",
    label: "Commandes ban",
    description: "`.ban`, `.unban`",
  },
};

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
    console.error("[rolePermStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @param {"mod"|"ban"} group
 * @returns {string[]} IDs des rôles autorisés en plus des permissions Discord natives
 */
function getAllowedRoles(guildId, group) {
  const data = load();
  return data[guildId]?.[group] || [];
}

/**
 * Remplace la liste complète des rôles autorisés pour un groupe (le menu de
 * sélection envoie toujours l'ensemble des rôles cochés, pas un diff).
 * @param {string} guildId
 * @param {"mod"|"ban"} group
 * @param {string[]} roleIds
 */
function setAllowedRoles(guildId, group, roleIds) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][group] = roleIds;
  save();
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {"mod"|"ban"} group
 * @returns {boolean} true si un des rôles du membre est dans la liste autorisée pour ce groupe
 */
function memberHasAllowedRole(member, group) {
  if (!member) return false;
  const allowed = getAllowedRoles(member.guild.id, group);
  if (allowed.length === 0) return false;
  return member.roles.cache.some((r) => allowed.includes(r.id));
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
 * Recharge les rôles autorisés d'un serveur depuis une source externe (voir
 * utils/configChannel.js — la config sauvegardée dans un salon Discord dédié,
 * qui survit aux redéploiements Railway contrairement au disque local).
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
  getAllowedRoles,
  setAllowedRoles,
  memberHasAllowedRole,
  getRawGuildData,
  hydrateFromRemote,
  PERMISSION_GROUPS,
};
