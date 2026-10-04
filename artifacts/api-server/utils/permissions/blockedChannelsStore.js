const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("../jsonFile");

// "Salons bloqués" — un salon où AUCUNE commande du bot ne répond, peu
// importe le niveau de permission du membre (sauf owner/rang sys, toujours
// inconditionnels). Distinct de utils/commandRules.js (restriction PAR
// COMMANDE, PAR salon) : ceci est un blocage GLOBAL d'un salon entier, pour
// tout le monde, une seule liste par serveur — le cas d'usage étant "aucune
// commande ne doit répondre dans #general", pas "telle commande précise
// est interdite ici".
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "blockedChannels.json");

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
    console.error("[blockedChannelsStore] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!Array.isArray(data[guildId])) data[guildId] = [];
  return data[guildId];
}

/** @returns {string[]} IDs des salons bloqués sur ce serveur. */
function list(guildId) {
  return [...guildEntry(guildId)];
}

function isBlocked(guildId, channelId) {
  return guildEntry(guildId).includes(channelId);
}

/** @returns {boolean} true si désormais bloqué, false si désormais débloqué. */
function toggle(guildId, channelId) {
  const list = guildEntry(guildId);
  const idx = list.indexOf(channelId);
  if (idx === -1) {
    list.push(channelId);
    save();
    return true;
  }
  list.splice(idx, 1);
  save();
  return false;
}

module.exports = { list, isBlocked, toggle };
