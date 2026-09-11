const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Protections PERSONNELLES (!!panel, utils/personalProtection.js) : chaque
// membre active/désactive pour LUI-MÊME, aucun effet sur le reste du
// serveur — voir "Ça te concerne toi seul" dans la référence fournie.
// { [guildId]: { [userId]: { antiRoleRemove: bool, antiMove: bool, ... } } }
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
  antiMove: {
    label: "Anti-Déplacement Vocal",
    description: "Te replace dans ton salon vocal si quelqu'un t'en déplace de force",
  },
  antiMuteDeafen: {
    label: "Anti-Sourdine Forcée",
    description: "Annule un mute/sourdine vocal qu'on t'impose",
  },
  antiTimeout: {
    label: "Anti-Timeout",
    description: "Annule un timeout (mise en sourdine textuelle) qu'on t'inflige",
  },
  antiRename: {
    label: "Anti-Renommage",
    description: "Restaure ton pseudo si quelqu'un le change à ta place",
  },
  antiBan: {
    label: "Anti-Bannissement",
    description: "Te débannit automatiquement si quelqu'un d'autre te bannit",
  },
  antiKick: {
    label: "Alerte Expulsion",
    description: "T'envoie un lien pour revenir si on t'expulse (un bot ne peut pas te rajouter de force)",
  },
  antiGhostPing: {
    label: "Anti Ping Fantôme",
    description: "T'envoie en MP le contenu d'un message qui t'a mentionné puis a été supprimé",
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
