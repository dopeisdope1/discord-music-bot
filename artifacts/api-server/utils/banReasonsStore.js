const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Raisons de ban PRÉDÉFINIES, gérées par serveur depuis &panel (jamais codées
// en dur ici) — utils/banInfoCard.js ("&baninfo") les propose dans un menu,
// en plus d'une raison personnalisée toujours disponible.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "banReasons.json");

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
    console.error("[banReasonsStore] échec de la sauvegarde :", err);
  }
}

/** @returns {{id: string, label: string}[]} */
function list(guildId) {
  const data = load();
  return Array.isArray(data[guildId]) ? [...data[guildId]] : [];
}

/** @returns {{id: string, label: string}} la raison créée. */
function add(guildId, label) {
  const data = load();
  if (!Array.isArray(data[guildId])) data[guildId] = [];
  const entry = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label };
  data[guildId].push(entry);
  save();
  return entry;
}

/** @returns {boolean} false si l'identifiant n'existait pas. */
function remove(guildId, reasonId) {
  const data = load();
  const list_ = data[guildId] || [];
  const index = list_.findIndex((r) => r.id === reasonId);
  if (index === -1) return false;
  list_.splice(index, 1);
  save();
  return true;
}

const get = (guildId, reasonId) => list(guildId).find((r) => r.id === reasonId) || null;

module.exports = { list, add, remove, get };
