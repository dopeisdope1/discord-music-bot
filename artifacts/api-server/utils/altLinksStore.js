const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// "Double compte de" (utils/banInfoCard.js, "&baninfo") : associe un ban à
// un compte DÉJÀ signalé (liste des bans persistants, utils/
// zinkillerStore.js) — pas une détection automatique, juste le lien que le
// modérateur pose lui-même au moment de bannir, gardé pour référence future.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "altLinks.json");

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
    console.error("[altLinksStore] échec de la sauvegarde :", err);
  }
}

function link(guildId, targetId, linkedToId) {
  const data = load();
  if (!Array.isArray(data[guildId])) data[guildId] = [];
  data[guildId] = data[guildId].filter((e) => e.targetId !== targetId);
  data[guildId].push({ targetId, linkedToId, at: Date.now() });
  save();
}

/** @returns {string|null} l'ID du compte principal, si un lien a été posé. */
function getLinkedTo(guildId, targetId) {
  return (load()[guildId] || []).find((e) => e.targetId === targetId)?.linkedToId || null;
}

/** Tous les comptes déjà signalés comme "double compte de" ce compte principal. */
function getLinkedAccounts(guildId, principalId) {
  return (load()[guildId] || []).filter((e) => e.linkedToId === principalId).map((e) => e.targetId);
}

module.exports = { link, getLinkedTo, getLinkedAccounts };
