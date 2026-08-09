const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. Pointer DATA_DIR vers un Volume Railway monté (persistant,
// lui, entre les redéploiements) rend ce fichier permanent. Voir le README.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "permissionCategories.json");

// Commandes assignables à une catégorie de permission via `.panel` >
// Permissions (ou listées par `.helpall`/`.perms`). Exclut délibérément
// `.banall`, gardée strictement réservée aux vrais administrateurs (voir
// utils/textCommands.js) — trop destructrice pour être déléguée.
const ASSIGNABLE_COMMANDS = [
  "helpall",
  "perms",
  "panel",
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
  "clear",
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
    console.error("[permissionCategoryStore] échec de la sauvegarde :", err);
  }
}

function guildData(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { nextId: 1, categories: {} };
  return data[guildId];
}

/**
 * Catégories de permission d'un serveur, triées par numéro croissant.
 * Chaque catégorie est indépendante des autres (pas d'héritage automatique
 * entre "Permission 1" et "Permission 2" par exemple) : elle a sa propre
 * liste de commandes et sa propre liste de rôles autorisés.
 * @param {string} guildId
 * @returns {Array<{ id: number, commands: string[], roles: string[] }>}
 */
function getCategories(guildId) {
  const g = guildData(guildId);
  return Object.entries(g.categories)
    .map(([id, cat]) => ({ id: Number(id), commands: cat.commands, roles: cat.roles }))
    .sort((a, b) => a.id - b.id);
}

/**
 * @param {string} guildId
 * @param {number} id
 * @returns {{ id: number, commands: string[], roles: string[] }|null}
 */
function getCategory(guildId, id) {
  const g = guildData(guildId);
  const cat = g.categories[id];
  return cat ? { id: Number(id), commands: cat.commands, roles: cat.roles } : null;
}

/**
 * Crée une catégorie vide avec le prochain numéro disponible. Ce numéro n'est
 * jamais réutilisé même après suppression d'une catégorie — pour ne pas
 * mélanger accidentellement deux configurations différentes sous le même
 * numéro (une "Permission 3" supprimée reste absente, la suivante créée sera
 * "Permission 4" ou plus).
 * @param {string} guildId
 * @returns {number} l'id de la nouvelle catégorie
 */
function createCategory(guildId) {
  const g = guildData(guildId);
  const id = g.nextId;
  g.nextId += 1;
  g.categories[id] = { commands: [], roles: [] };
  save();
  return id;
}

/**
 * @param {string} guildId
 * @param {number} id
 */
function deleteCategory(guildId, id) {
  const g = guildData(guildId);
  delete g.categories[id];
  save();
}

/**
 * Remplace la liste complète des commandes d'une catégorie (le menu de
 * sélection envoie toujours l'ensemble coché, pas un diff).
 * @param {string} guildId
 * @param {number} id
 * @param {string[]} commands
 */
function setCategoryCommands(guildId, id, commands) {
  const g = guildData(guildId);
  if (!g.categories[id]) return;
  g.categories[id].commands = commands;
  save();
}

/**
 * Remplace la liste complète des rôles autorisés d'une catégorie.
 * @param {string} guildId
 * @param {number} id
 * @param {string[]} roleIds
 */
function setCategoryRoles(guildId, id, roleIds) {
  const g = guildData(guildId);
  if (!g.categories[id]) return;
  g.categories[id].roles = roleIds;
  save();
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {string} guildId
 * @param {string} command
 * @returns {boolean} true si un des rôles du membre est autorisé pour une
 *   catégorie qui inclut cette commande
 */
function hasCommandAccess(member, guildId, command) {
  if (!member) return false;
  return getCategories(guildId).some(
    (cat) => cat.commands.includes(command) && cat.roles.some((roleId) => member.roles.cache.has(roleId))
  );
}

/**
 * Valeurs brutes d'un serveur, utilisé par utils/configChannel.js pour
 * sauvegarder/restaurer via Discord.
 * @param {string} guildId
 */
function getRawGuildData(guildId) {
  return load()[guildId] || { nextId: 1, categories: {} };
}

/**
 * Recharge les catégories de permission d'un serveur depuis une source
 * externe (voir utils/configChannel.js — la config sauvegardée dans un salon
 * Discord dédié, qui survit aux redéploiements Railway contrairement au
 * disque local).
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
  ASSIGNABLE_COMMANDS,
  getCategories,
  getCategory,
  createCategory,
  deleteCategory,
  setCategoryCommands,
  setCategoryRoles,
  hasCommandAccess,
  getRawGuildData,
  hydrateFromRemote,
};
