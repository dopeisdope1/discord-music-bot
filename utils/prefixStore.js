const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. Pointer DATA_DIR vers un Volume Railway monté (persistant,
// lui, entre les redéploiements) rend ce fichier permanent. Voir le README.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "prefixes.json");

// "?" car c'est la valeur actuellement configurée sur le serveur : tant que
// data/prefixes.json ne survit pas à un redéploiement (voir DATA_DIR
// ci-dessus), c'est cette valeur par défaut qui s'applique après coup.
const DEFAULT_PREFIXES = { main: "?", dash: "." };

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
