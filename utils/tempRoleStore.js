const fs = require("fs");
const path = require("path");

// Suivi des rôles temporaires (&temprole) pour les retirer automatiquement
// à l'échéance — fichier dédié, même principe que utils/tempBanStore.js.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "tempRoles.json");

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[tempRoleStore] échec de la sauvegarde :", err);
  }
}

function add(guildId, userId, roleId, expiresAt) {
  const list = load().filter((r) => !(r.guildId === guildId && r.userId === userId && r.roleId === roleId));
  list.push({ guildId, userId, roleId, expiresAt });
  cache = list;
  save();
}
function remove(guildId, userId, roleId) {
  cache = load().filter((r) => !(r.guildId === guildId && r.userId === userId && r.roleId === roleId));
  save();
}

/** Rôles temporaires dont l'échéance est dépassée — à traiter puis retirer via remove(). */
function getExpired() {
  const now = Date.now();
  return load().filter((r) => r.expiresAt <= now);
}

module.exports = { add, remove, getExpired };
