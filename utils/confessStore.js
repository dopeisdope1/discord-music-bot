const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Confessions anonymes ("!!confess", voir utils/confessions.js).
// { [guildId]: { channelId: string|null, validationChannelId: string|null,
//                notifOptIns: string[] } }
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
  if (entry.validationChannelId === undefined) entry.validationChannelId = null;
  if (!Array.isArray(entry.notifOptIns)) entry.notifOptIns = [];
  return entry;
}

function getConfig(guildId) {
  const { channelId, validationChannelId, notifOptIns } = guildEntry(guildId);
  return { channelId, validationChannelId, notifOptIns: [...notifOptIns] };
}

function setChannel(guildId, channelId) {
  guildEntry(guildId).channelId = channelId;
  save();
}

/** Salon staff où les confessions attendent Approuver/Refuser avant publication (facultatif — sans lui, publication directe). */
function setValidationChannel(guildId, channelId) {
  guildEntry(guildId).validationChannelId = channelId;
  save();
}

/** @returns {boolean} le nouvel état (activé/désactivé), après bascule. */
function toggleNotif(guildId, userId) {
  const entry = guildEntry(guildId);
  const index = entry.notifOptIns.indexOf(userId);
  const actif = index === -1;
  if (actif) entry.notifOptIns.push(userId);
  else entry.notifOptIns.splice(index, 1);
  save();
  return actif;
}

module.exports = { getConfig, setChannel, setValidationChannel, toggleNotif };
