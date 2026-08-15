const fs = require("fs");
const path = require("path");

// Config seulement (seuils, paliers activés) — les stats EWMA par membre
// restent en mémoire (voir utils/antiraidDetector.js), pas besoin de les
// faire survivre à un redémarrage.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "antiraidConfig.json");

const DEFAULTS = {
  warnEnabled: true,
  throttleEnabled: true,
  lockEnabled: true,
  warnThreshold: 2.5,
  throttleThreshold: 4,
  lockThreshold: 6,
};

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
    console.error("[antiraidConfigStore] échec de la sauvegarde :", err);
  }
}

function getConfig(guildId) {
  const data = load();
  return { ...DEFAULTS, ...(data[guildId] || {}) };
}

function setTierEnabled(guildId, tier, enabled) {
  const data = load();
  data[guildId] = { ...getConfig(guildId), [`${tier}Enabled`]: enabled };
  save();
}

function setThresholds(guildId, { warn, throttle, lock }) {
  const data = load();
  data[guildId] = { ...getConfig(guildId), warnThreshold: warn, throttleThreshold: throttle, lockThreshold: lock };
  save();
}

function getRawGuildData(guildId) {
  return load()[guildId] || {};
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = { getConfig, setTierEnabled, setThresholds, getRawGuildData, hydrateFromRemote };
