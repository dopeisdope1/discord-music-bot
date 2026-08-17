const fs = require("fs");
const path = require("path");

// Liste par serveur des membres de confiance autorisés à déclencher les
// commandes de niveau `owner` (aujourd'hui : &banall) sans être le
// propriétaire réel du serveur — remplace l'ancien critère "a la permission
// Administrateur", trop large (n'importe quel rôle admin pouvait déclencher
// une demande de ban de masse). Gérée via &banalladmins.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "ownerTrust.json");

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
    console.error("[ownerTrustStore] échec de la sauvegarde :", err);
  }
}

function ensureGuild(guildId) {
  const data = load();
  if (!Array.isArray(data[guildId])) data[guildId] = [];
  return data[guildId];
}

function add(guildId, userId) {
  const list = ensureGuild(guildId);
  if (!list.includes(userId)) list.push(userId);
  save();
}

function remove(guildId, userId) {
  const data = load();
  data[guildId] = ensureGuild(guildId).filter((id) => id !== userId);
  save();
}

function isTrusted(guildId, userId) {
  return ensureGuild(guildId).includes(userId);
}

function list(guildId) {
  return [...ensureGuild(guildId)];
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

module.exports = { add, remove, isTrusted, list, getRawGuildData, hydrateFromRemote };
