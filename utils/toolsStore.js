const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. Pointer DATA_DIR vers un Volume Railway monté (persistant,
// lui, entre les redéploiements) rend ce fichier permanent. Voir le README.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "tools.json");

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
    console.error("[toolsStore] échec de la sauvegarde :", err);
  }
}

function guildData(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { deroRoleId: null, counterChannelId: null, counterTemplate: "Membres: {count}" };
  return data[guildId];
}

/**
 * @param {string} guildId
 * @returns {string|null} rôle appliqué automatiquement (accès complet) sur
 *   chaque nouveau salon créé — voir .dero
 */
function getDeroRole(guildId) {
  return guildData(guildId).deroRoleId;
}

function setDeroRole(guildId, roleId) {
  const g = guildData(guildId);
  g.deroRoleId = roleId;
  save();
}

/**
 * @param {string} guildId
 * @returns {{ channelId: string|null, template: string }}
 */
function getCounter(guildId) {
  const g = guildData(guildId);
  return { channelId: g.counterChannelId, template: g.counterTemplate };
}

function setCounter(guildId, channelId, template) {
  const g = guildData(guildId);
  g.counterChannelId = channelId;
  if (template) g.counterTemplate = template;
  save();
}

/**
 * Valeurs brutes d'un serveur, utilisé par utils/configChannel.js pour
 * sauvegarder/restaurer via Discord.
 * @param {string} guildId
 */
function getRawGuildData(guildId) {
  return load()[guildId] || { deroRoleId: null, counterChannelId: null, counterTemplate: "Membres: {count}" };
}

/**
 * Recharge la config outils d'un serveur depuis une source externe (voir
 * utils/configChannel.js).
 * @param {string} guildId
 * @param {object} remoteData
 */
function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = { ...data[guildId], ...remoteData };
  save();
}

module.exports = { getDeroRole, setDeroRole, getCounter, setCounter, getRawGuildData, hydrateFromRemote };
