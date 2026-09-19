const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// "&emoji" — personnalise l'emoji affiché en en-tête de chaque GROUPE dans
// les pages d'aide (&help/-help/!!help/=help, voir utils/helpNavigator.js),
// PAR SERVEUR. Un "slot" = une catégorie du catalogue central (utils/
// commandCatalog.js) ou un groupe des listes figées "!!"/"=" — jamais une
// commande individuelle : la granularité voulue est celle déjà visible
// dans l'aide groupée, pas les ~210 commandes une par une.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "categoryEmojis.json");

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = lireJson(DATA_FILE);
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireJson(DATA_FILE, cache);
  } catch (err) {
    console.error("[categoryEmojiStore] échec de la sauvegarde :", err);
  }
}

/** @returns {string|null} l'emoji personnalisé pour ce slot, ou null (retombe sur l'emoji par défaut). */
function get(guildId, slotKey) {
  return load()[guildId]?.[slotKey] || null;
}

/** @returns {Record<string,string>} tous les emojis personnalisés de ce serveur. */
function list(guildId) {
  return { ...(load()[guildId] || {}) };
}

function set(guildId, slotKey, emoji) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][slotKey] = emoji;
  save();
}

/** @returns {boolean} false si ce slot n'avait rien de personnalisé. */
function reset(guildId, slotKey) {
  const data = load();
  if (!data[guildId] || !(slotKey in data[guildId])) return false;
  delete data[guildId][slotKey];
  save();
  return true;
}

module.exports = { get, list, set, reset };
