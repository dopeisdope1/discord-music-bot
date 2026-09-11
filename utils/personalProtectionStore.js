const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Protections PERSONNELLES (!!panel, utils/personalProtection.js) : chaque
// membre active/désactive pour LUI-MÊME, aucun effet sur le reste du
// serveur — voir "Ça te concerne toi seul" dans la référence fournie.
// { [guildId]: { [userId]: { antiRoleRemove: bool } } }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "personalProtection.json");

// Liste de vérité des protections disponibles. Ajouter une clé ici suffit à
// la faire apparaître dans !!panel (voir utils/personalProtection.js) avec
// sa valeur par défaut à `false` — rien à changer côté stockage.
const PROTECTIONS = {
  antiRoleRemove: {
    label: "Anti-Retrait Rôle",
    description: "Réapplique automatiquement un rôle qu'on t'a retiré",
  },
};

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
    console.error("[personalProtectionStore] échec de la sauvegarde :", err);
  }
}

/** @returns {Object<string, boolean>} une entrée par protection connue, `false` si jamais réglée. */
function getSettings(guildId, userId) {
  const brut = load()[guildId]?.[userId] || {};
  const settings = {};
  for (const key of Object.keys(PROTECTIONS)) settings[key] = Boolean(brut[key]);
  return settings;
}

/** @returns {boolean} le nouvel état, après bascule. */
function toggle(guildId, userId, key) {
  if (!PROTECTIONS[key]) throw new Error(`Protection inconnue : ${key}`);
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][userId]) data[guildId][userId] = {};
  const nouveau = !data[guildId][userId][key];
  data[guildId][userId][key] = nouveau;
  save();
  return nouveau;
}

const isEnabled = (guildId, userId, key) => Boolean(load()[guildId]?.[userId]?.[key]);

module.exports = { PROTECTIONS, getSettings, toggle, isEnabled };
