const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. La liste est aussi sauvegardée dans le salon Discord partagé
// "zinki-config" (voir utils/configChannel.js), qui lui survit aux redéploiements.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "blacklist.json");

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
    console.error("[blacklistStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @returns {{ [userId: string]: { reason: string, addedById: string, addedAt: number } }}
 */
function getBlacklistMap(guildId) {
  const data = load();
  return data[guildId] || {};
}

/**
 * @param {string} guildId
 * @returns {Array<{ userId: string, reason: string, addedById: string, addedAt: number }>}
 */
function getBlacklist(guildId) {
  const map = getBlacklistMap(guildId);
  return Object.entries(map).map(([userId, entry]) => ({ userId, ...entry }));
}

/**
 * @param {string} guildId
 * @param {string} userId
 */
function isBlacklisted(guildId, userId) {
  return Boolean(getBlacklistMap(guildId)[userId]);
}

/**
 * @param {string} guildId
 * @param {string} userId
 */
function getBlacklistEntry(guildId, userId) {
  return getBlacklistMap(guildId)[userId] || null;
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {{ reason: string, addedById: string }} info
 */
function addToBlacklist(guildId, userId, { reason, addedById }) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][userId] = { reason: reason || "Aucune raison fournie", addedById, addedAt: Date.now() };
  save();
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @returns {boolean} true si l'entrée existait et a été retirée
 */
function removeFromBlacklist(guildId, userId) {
  const data = load();
  if (!data[guildId]?.[userId]) return false;
  delete data[guildId][userId];
  save();
  return true;
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
 * Recharge la blacklist d'un serveur depuis une source externe (voir
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
  getBlacklist,
  isBlacklisted,
  getBlacklistEntry,
  addToBlacklist,
  removeFromBlacklist,
  getRawGuildData,
  hydrateFromRemote,
};
