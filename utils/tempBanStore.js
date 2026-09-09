const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Suivi des bans temporaires (&tempban) pour les lever automatiquement à
// l'échéance — fichier dédié, distinct de utils/muteStore.js (deux
// ressources différentes, ne jamais partager la même liste d'échéances).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "tempBans.json");

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = lireJson(DATA_FILE);
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireJson(DATA_FILE, cache);
  } catch (err) {
    console.error("[tempBanStore] échec de la sauvegarde :", err);
  }
}

function add(guildId, userId, expiresAt) {
  const list = load().filter((b) => !(b.guildId === guildId && b.userId === userId));
  list.push({ guildId, userId, expiresAt });
  cache = list;
  save();
}
function remove(guildId, userId) {
  cache = load().filter((b) => !(b.guildId === guildId && b.userId === userId));
  save();
}

/** Bans temporaires dont l'échéance est dépassée — à traiter puis retirer via remove(). */
function getExpired() {
  const now = Date.now();
  return load().filter((b) => b.expiresAt <= now);
}

module.exports = { add, remove, getExpired };
