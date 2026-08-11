const fs = require("fs");
const path = require("path");

// Limiteur d'actions par rôle (`limit`) : complète les seuils par module de
// utils/antiNuke.js (par compte) avec un plafond par RÔLE — utile pour
// détecter un abus réparti sur plusieurs comptes partageant un même rôle
// (staff compromis en masse), ce que les seuils par compte ne voient pas.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "roleLimits.json");

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
    console.error("[roleLimitStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @returns {{ [roleId: string]: { threshold: number, windowMs: number } }}
 */
function getAllRoleLimits(guildId) {
  return { ...(load()[guildId] || {}) };
}

function setRoleLimit(guildId, roleId, threshold, windowMs) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][roleId] = { threshold, windowMs };
  save();
}

function removeRoleLimit(guildId, roleId) {
  const data = load();
  if (!data[guildId]) return;
  delete data[guildId][roleId];
  save();
}

function getRawGuildData(guildId) {
  return load()[guildId] || {};
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = { ...data[guildId], ...remoteData };
  save();
}

module.exports = {
  getAllRoleLimits,
  setRoleLimit,
  removeRoleLimit,
  getRawGuildData,
  hydrateFromRemote,
};
