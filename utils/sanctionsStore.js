const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "sanctions.json");

let cache = null;
let nextId = 1;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    cache = {};
  }
  for (const rows of Object.values(cache)) {
    for (const row of rows) if (row.id >= nextId) nextId = row.id + 1;
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[sanctionsStore] échec de la sauvegarde :", err);
  }
}

function add(guildId, userId, type, reason, moderatorId) {
  const data = load();
  if (!data[guildId]) data[guildId] = [];
  data[guildId].push({ id: nextId++, userId, type, reason: reason || null, moderatorId, createdAt: Date.now() });
  save();
}

function listForUser(guildId, userId) {
  const data = load();
  return (data[guildId] || []).filter((s) => s.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
}

function countByGuild(guildId) {
  const data = load();
  return (data[guildId] || []).length;
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

module.exports = { add, listForUser, countByGuild, getRawGuildData, hydrateFromRemote };
