const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Rôle donné en cliquant sur le bouton de vérification (voir &panel >
// Membres et utils/verification.js) — un rôle existant, jamais créé par le
// bot ; c'est à l'admin de restreindre les salons à ce rôle depuis Discord.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "verification.json");

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
    console.error("[verificationStore] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { roleId: null, channelId: null };
  return data[guildId];
}

/** @returns {{ roleId: string|null, channelId: string|null }} */
function getConfig(guildId) {
  return { ...guildEntry(guildId) };
}

function setRole(guildId, roleId) {
  guildEntry(guildId).roleId = roleId || null;
  save();
}

function setChannel(guildId, channelId) {
  guildEntry(guildId).channelId = channelId || null;
  save();
}

module.exports = { getConfig, setRole, setChannel };
