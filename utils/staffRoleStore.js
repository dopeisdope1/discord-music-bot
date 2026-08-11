const fs = require("fs");
const path = require("path");

// Rôles désignés "staff" (`staff`/`staff-list`) — purement informatif pour
// l'instant (liste consultable), ne modifie aucune permission par lui-même.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "staffRoles.json");

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
    console.error("[staffRoleStore] échec de la sauvegarde :", err);
  }
}

function getStaffRoles(guildId) {
  return [...(load()[guildId] || [])];
}

function addStaffRole(guildId, roleId) {
  const data = load();
  if (!data[guildId]) data[guildId] = [];
  if (!data[guildId].includes(roleId)) data[guildId].push(roleId);
  save();
}

function removeStaffRole(guildId, roleId) {
  const data = load();
  if (!data[guildId]) return;
  data[guildId] = data[guildId].filter((id) => id !== roleId);
  save();
}

function getRawGuildData(guildId) {
  return load()[guildId] || [];
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = { getStaffRoles, addStaffRole, removeStaffRole, getRawGuildData, hydrateFromRemote };
