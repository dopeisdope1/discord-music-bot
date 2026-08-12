const fs = require("fs");
const path = require("path");

// Dernier salon utilisé avec `&say` en DM (voir utils/sayDm.js), par
// utilisateur — évite de recopier l'ID/lien à chaque fois. DATA_DIR pointe
// vers le Volume Railway persistant (voir utils/prefixStore.js pour le
// même mécanisme).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "sayDm.json");

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
    console.error("[sayDmStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} userId
 * @returns {string|null}
 */
function getLastChannel(userId) {
  return load()[userId] || null;
}

/**
 * @param {string} userId
 * @param {string} channelId
 */
function setLastChannel(userId, channelId) {
  const data = load();
  data[userId] = channelId;
  save();
}

module.exports = { getLastChannel, setLastChannel };
