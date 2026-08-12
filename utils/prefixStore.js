const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. Pointer DATA_DIR vers un Volume Railway monté (persistant,
// lui, entre les redéploiements) rend ce fichier permanent. Voir le README.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "prefixes.json");

// Valeurs par défaut avant toute config (la vraie valeur, une fois changée
// via &panel, est restaurée depuis Discord — voir utils/configChannel.js ;
// ces valeurs ne servent que si cette restauration ne trouve rien du tout).
// main = préfixe musique ; musicMod = préfixe des commandes de modération
// dupliquées sur ce même bot (voir utils/musicModerationCommands.js).
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

/**
 * Valeurs personnalisées brutes d'un serveur (sans les valeurs par défaut),
 * utilisé par utils/configChannel.js pour sauvegarder/restaurer via Discord.
 * @param {string} guildId
 */
function getRawGuildData(guildId) {
  return load()[guildId] || {};
}

/**
 * Recharge les valeurs personnalisées d'un serveur depuis une source externe
 * (voir utils/configChannel.js — la config sauvegardée dans un salon Discord
 * dédié, qui survit aux redéploiements Railway contrairement au disque local).
 * @param {string} guildId
 * @param {object} remoteData
 */
function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = { ...data[guildId], ...remoteData };
  save();
}

module.exports = { getPrefixes, setPrefix, getRawGuildData, hydrateFromRemote, DEFAULT_PREFIXES };
