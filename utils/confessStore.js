const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Salon des confessions anonymes ("!!confess", voir utils/confessions.js).
// { [guildId]: { channelId: string|null, compteur: number } }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "confess.json");

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
    console.error("[confessStore] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  const entry = data[guildId];
  if (entry.channelId === undefined) entry.channelId = null;
  if (typeof entry.compteur !== "number") entry.compteur = 0;
  return entry;
}

function getConfig(guildId) {
  const { channelId, compteur } = guildEntry(guildId);
  return { channelId, compteur };
}

function setChannel(guildId, channelId) {
  guildEntry(guildId).channelId = channelId;
  save();
}

/** @returns {number} le numéro à donner à CETTE confession (incrémente le compteur). */
function prochainNumero(guildId) {
  const entry = guildEntry(guildId);
  entry.compteur += 1;
  save();
  return entry.compteur;
}

module.exports = { getConfig, setChannel, prochainNumero };
