const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "prefixes.json");

const DEFAULT_PREFIXES = { main: "!", dash: "." };

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
    console.error("[prefixStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @returns {{ main: string, dash: string }} main = préfixe musique (!), dash = préfixe membres/modération (.)
 */
function getPrefixes(guildId) {
  const data = load();
  return { ...DEFAULT_PREFIXES, ...(data[guildId] || {}) };
}

/**
 * @param {string} guildId
 * @param {"main"|"dash"} type
 * @param {string} value
 */
function setPrefix(guildId, type, value) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][type] = value;
  save();
}

module.exports = { getPrefixes, setPrefix, DEFAULT_PREFIXES };
