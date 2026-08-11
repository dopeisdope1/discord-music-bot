const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. La liste est aussi sauvegardée dans le salon Discord
// partagé "zinki-config" (voir utils/configChannel.js), qui lui survit aux
// redéploiements.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "warns.json");

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
    console.error("[warnStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @returns {Array<{ id: number, reason: string, moderatorId: string, timestamp: number }>}
 */
function getWarns(guildId, userId) {
  const data = load();
  return data[guildId]?.[userId] || [];
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {{ reason: string, moderatorId: string }} info
 * @returns {{ id: number, reason: string, moderatorId: string, timestamp: number }}
 */
function addWarn(guildId, userId, { reason, moderatorId }) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][userId]) data[guildId][userId] = [];
  const warns = data[guildId][userId];
  // ID local à ce membre (1, 2, 3...) plutôt qu'un ID global — plus lisible
  // pour `delwarn`, pas besoin de connaître un ID à 10 chiffres.
  const id = warns.length ? warns[warns.length - 1].id + 1 : 1;
  const warn = { id, reason: reason || "Aucune raison fournie", moderatorId, timestamp: Date.now() };
  warns.push(warn);
  save();
  return warn;
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {number} warnId
 * @returns {boolean} true si l'avertissement existait et a été retiré
 */
function removeWarn(guildId, userId, warnId) {
  const data = load();
  const warns = data[guildId]?.[userId];
  if (!warns) return false;
  const index = warns.findIndex((w) => w.id === warnId);
  if (index === -1) return false;
  warns.splice(index, 1);
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
 * Recharge les avertissements d'un serveur depuis une source externe (voir
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

module.exports = { getWarns, addWarn, removeWarn, getRawGuildData, hydrateFromRemote };
