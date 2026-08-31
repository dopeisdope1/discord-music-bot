const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. Pointer DATA_DIR vers un Volume Railway monté (persistant,
// lui, entre les redéploiements) rend ce fichier permanent. Voir le README.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "prefixes.json");

// Valeurs par défaut, utilisées tant que rien n'a été changé via &panel.
// main = préfixe musique ; musicMod = préfixe des autres commandes, partagé
// avec le CrowBot du serveur (voir utils/musicCommands.js).
const DEFAULT_PREFIXES = { main: "?", musicMod: "&" };

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
 * @returns {{ main: string, musicMod: string }} main = préfixe musique (!), musicMod = préfixe modération (?)
 */
function getPrefixes(guildId) {
  const data = load();
  return { ...DEFAULT_PREFIXES, ...(data[guildId] || {}) };
}

/**
 * @param {string} guildId
 * @param {"main"|"musicMod"} type
 * @param {string} value
 */
function setPrefix(guildId, type, value) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][type] = value;
  save();
}

module.exports = { getPrefixes, setPrefix, DEFAULT_PREFIXES };
