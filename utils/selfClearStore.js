const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Config par serveur du déclencheur "<nom> clear" (voir utils/selfClear.js) —
// remplace l'ancien "uo clear" fixé en dur. Réglable via "!!setclear"
// (utils/setClearCommand.js), gardé derrière la permission
// "server.selfclear.manage" (utils/permissions/catalog.js) comme le reste.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "selfClear.json");

// Valeurs de départ : identiques au comportement figé qui existait avant
// (un seul nom, "uo"), pour ne rien changer tant que personne n'a reconfiguré.
const DEFAULT_NAMES = ["uo"];
const DEFAULT_COOLDOWN_MS = 15 * 60_000;

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
    console.error("[selfClearStore] échec de la sauvegarde :", err);
  }
}

function getConfig(guildId) {
  const entry = load()[guildId];
  return {
    names: entry?.names ?? DEFAULT_NAMES,
    cooldownMs: entry?.cooldownMs ?? DEFAULT_COOLDOWN_MS,
  };
}

function setNames(guildId, names) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId].names = names;
  save();
}

function setCooldown(guildId, cooldownMs) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId].cooldownMs = cooldownMs;
  save();
}

function resetConfig(guildId) {
  const data = load();
  delete data[guildId];
  save();
}

module.exports = { getConfig, setNames, setCooldown, resetConfig, DEFAULT_NAMES, DEFAULT_COOLDOWN_MS };
