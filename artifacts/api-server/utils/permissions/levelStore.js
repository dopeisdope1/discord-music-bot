const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("../jsonFile");
const { LEVEL_MIN, LEVEL_MAX } = require("./levelCatalog");

// Niveau (1-9) assigné à un RÔLE ou à un MEMBRE INDIVIDUEL, par serveur —
// remplace les octrois clé par clé de utils/permissions/store.js (conservé
// pour mémoire/migration, plus consommé par engine.js).
//
// Structure : { [guildId]: { roleLevels: {roleId: 1-9}, userLevels: {userId: 1-9} } }
// Un membre peut avoir un niveau individuel EN PLUS de celui de ses rôles —
// le niveau effectif retenu est toujours le PLUS HAUT des deux (voir
// engine.js::levelOf), jamais un remplacement de l'un par l'autre.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "permissionLevels.json");

let cache = null;
function load() {
  if (cache) return cache;
  try {
    cache = lireJson(DATA_FILE);
  } catch {
    cache = {};
  }
  return cache;
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireJson(DATA_FILE, cache);
  } catch (err) {
    console.error("[levelStore] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { roleLevels: {}, userLevels: {} };
  if (!data[guildId].roleLevels) data[guildId].roleLevels = {};
  if (!data[guildId].userLevels) data[guildId].userLevels = {};
  return data[guildId];
}

const clampLevel = (n) => Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.floor(n)));

/** @returns {number|null} niveau assigné à ce rôle, ou null si aucun. */
function getRoleLevel(guildId, roleId) {
  const lvl = guildEntry(guildId).roleLevels[roleId];
  return Number.isInteger(lvl) ? lvl : null;
}

/** @param {number|null} level null pour retirer le niveau de ce rôle. */
function setRoleLevel(guildId, roleId, level) {
  const entry = guildEntry(guildId);
  if (level == null) delete entry.roleLevels[roleId];
  else entry.roleLevels[roleId] = clampLevel(level);
  save();
}

/** @returns {number|null} niveau individuel assigné à ce membre, ou null si aucun. */
function getUserLevel(guildId, userId) {
  const lvl = guildEntry(guildId).userLevels[userId];
  return Number.isInteger(lvl) ? lvl : null;
}

/** @param {number|null} level null pour retirer le niveau individuel de ce membre. */
function setUserLevel(guildId, userId, level) {
  const entry = guildEntry(guildId);
  if (level == null) delete entry.userLevels[userId];
  else entry.userLevels[userId] = clampLevel(level);
  save();
}

/** @returns {[roleId, number][]} tous les rôles ayant un niveau assigné sur ce serveur. */
function listRoleLevels(guildId) {
  return Object.entries(guildEntry(guildId).roleLevels);
}

/** @returns {[userId, number][]} tous les membres ayant un niveau individuel assigné sur ce serveur. */
function listUserLevels(guildId) {
  return Object.entries(guildEntry(guildId).userLevels);
}

/** Retire tout niveau assigné à ce rôle (ex: rôle supprimé côté Discord) — voir utils/permissions/cleanup.js. */
function clearRole(guildId, roleId) {
  const entry = guildEntry(guildId);
  if (!(roleId in entry.roleLevels)) return false;
  delete entry.roleLevels[roleId];
  save();
  return true;
}

/** Retire le niveau individuel d'un membre (ex: départ du serveur) — voir utils/permissions/cleanup.js. */
function clearUser(guildId, userId) {
  const entry = guildEntry(guildId);
  if (!(userId in entry.userLevels)) return false;
  delete entry.userLevels[userId];
  save();
  return true;
}

module.exports = {
  LEVEL_MIN,
  LEVEL_MAX,
  getRoleLevel,
  setRoleLevel,
  getUserLevel,
  setUserLevel,
  listRoleLevels,
  listUserLevels,
  clearRole,
  clearUser,
};
