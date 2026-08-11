const fs = require("fs");
const path = require("path");

// Blacklist de rôle PAR MEMBRE (`blr`) : si l'un des rôles listés pour un
// membre lui est donné (peu importe qui l'a donné, même un owner anti-nuke —
// contrairement à `secur` qui ne vérifie que l'exécuteur), utils/antiNuke.js
// le retire automatiquement.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "roleBlacklist.json");

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
    console.error("[roleBlacklistStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @returns {{ [userId: string]: string[] }}
 */
function getAll(guildId) {
  return { ...(load()[guildId] || {}) };
}

function getBlacklistedRoles(guildId, userId) {
  return [...(getAll(guildId)[userId] || [])];
}

function isRoleBlacklistedFor(guildId, userId, roleId) {
  return getBlacklistedRoles(guildId, userId).includes(roleId);
}

function addBlacklistedRole(guildId, userId, roleId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][userId]) data[guildId][userId] = [];
  if (!data[guildId][userId].includes(roleId)) data[guildId][userId].push(roleId);
  save();
}

function removeBlacklistedRole(guildId, userId, roleId) {
  const data = load();
  if (!data[guildId]?.[userId]) return;
  data[guildId][userId] = data[guildId][userId].filter((id) => id !== roleId);
  if (data[guildId][userId].length === 0) delete data[guildId][userId];
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
  getAll,
  getBlacklistedRoles,
  isRoleBlacklistedFor,
  addBlacklistedRole,
  removeBlacklistedRole,
  getRawGuildData,
  hydrateFromRemote,
};
