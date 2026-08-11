const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. La liste est aussi sauvegardée dans le salon Discord
// partagé "zinki-config" (voir utils/configChannel.js), qui lui survit aux
// redéploiements.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "tempbans.json");

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
    console.error("[tempBanStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {number} expiresAt timestamp ms
 */
function addTempBan(guildId, userId, expiresAt) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][userId] = expiresAt;
  save();
}

/**
 * @param {string} guildId
 * @param {string} userId
 */
function removeTempBan(guildId, userId) {
  const data = load();
  if (data[guildId]?.[userId] !== undefined) {
    delete data[guildId][userId];
    save();
  }
}

/**
 * Tous les bannissements temporaires actuellement enregistrés, tous serveurs
 * confondus — à appeler périodiquement pour débannir ceux arrivés à
 * expiration (voir gestion.js).
 * @returns {Array<{ guildId: string, userId: string, expiresAt: number }>}
 */
function getAllTempBans() {
  const data = load();
  const result = [];
  for (const guildId of Object.keys(data)) {
    for (const userId of Object.keys(data[guildId])) {
      result.push({ guildId, userId, expiresAt: data[guildId][userId] });
    }
  }
  return result;
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
 * Recharge les bannissements temporaires d'un serveur depuis une source
 * externe (voir utils/configChannel.js).
 * @param {string} guildId
 * @param {object} remoteData
 */
function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = { ...data[guildId], ...remoteData };
  save();
}

module.exports = { addTempBan, removeTempBan, getAllTempBans, getRawGuildData, hydrateFromRemote };
