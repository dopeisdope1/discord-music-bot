const fs = require("fs");
const path = require("path");

// Statut AFK par serveur/membre — volontairement PAS synchronisé via le
// salon de config Discord (voir utils/configChannel.js) : contrairement aux
// warns/tempbans, un statut AFK est censé être de courte durée, le perdre
// lors d'un redéploiement Railway est sans conséquence.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "afk.json");

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
    console.error("[afkStore] échec de la sauvegarde :", err);
  }
}

function setAfk(guildId, userId, reason) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][userId] = { reason, since: Date.now() };
  save();
}

function getAfk(guildId, userId) {
  return load()[guildId]?.[userId] || null;
}

/**
 * @returns {{reason: string, since: number}|null} l'entrée retirée, ou null si le membre n'était pas AFK
 */
function clearAfk(guildId, userId) {
  const data = load();
  const entry = data[guildId]?.[userId];
  if (!entry) return null;
  delete data[guildId][userId];
  save();
  return entry;
}

module.exports = { setAfk, getAfk, clearAfk };
