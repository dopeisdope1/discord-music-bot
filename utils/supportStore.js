const fs = require("fs");
const path = require("path");

// Lien de support configurable par serveur (`setsupport`) — synchronisé via
// le salon de config Discord comme le reste (voir utils/configChannel.js).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "support.json");

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
    console.error("[supportStore] échec de la sauvegarde :", err);
  }
}

function setSupportUrl(guildId, url) {
  const data = load();
  data[guildId] = url;
  save();
}

function getSupportUrl(guildId) {
  return load()[guildId] || null;
}

function getRawGuildData(guildId) {
  return load()[guildId] || null;
}

function hydrateFromRemote(guildId, remoteData) {
  if (remoteData === undefined || remoteData === null) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = { setSupportUrl, getSupportUrl, getRawGuildData, hydrateFromRemote };
