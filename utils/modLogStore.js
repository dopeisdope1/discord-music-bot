const fs = require("fs");
const path = require("path");

// Même logique que prefixStore.js : DATA_DIR pointe vers un Volume Railway
// monté, sans quoi le salon de logs choisi serait oublié à chaque
// redéploiement.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "modLog.json");

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
    console.error("[modLogStore] échec de la sauvegarde :", err);
  }
}

/** @returns {string|null} l'identifiant du salon de logs du serveur, ou null si aucun n'est configuré. */
function getLogChannelId(guildId) {
  return load()[guildId]?.channelId || null;
}

/** @param {string|null} channelId null pour désactiver les logs. */
function setLogChannelId(guildId, channelId) {
  const data = load();
  if (!channelId) delete data[guildId];
  else data[guildId] = { channelId };
  save();
}

module.exports = { getLogChannelId, setLogChannelId };
