const fs = require("fs");
const path = require("path");

// Salons vocaux temporaires : un salon "générateur" (le hub) configuré par
// serveur ; le rejoindre crée un salon vocal personnel et y déplace le
// membre, supprimé automatiquement quand il se vide (voir index.js,
// listener "voiceStateUpdate" dédié, séparé de celui du player musique).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const HUB_FILE = path.join(DATA_DIR, "voiceHub.json");
const CHANNELS_FILE = path.join(DATA_DIR, "tempVoiceChannels.json");

let hubCache = null;
let channelsCache = null;

function loadHubs() {
  if (hubCache) return hubCache;
  try {
    hubCache = JSON.parse(fs.readFileSync(HUB_FILE, "utf8"));
  } catch {
    hubCache = {};
  }
  return hubCache;
}

function saveHubs() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HUB_FILE, JSON.stringify(hubCache, null, 2));
  } catch (err) {
    console.error("[voiceChannels] échec de la sauvegarde (hub) :", err);
  }
}

function loadChannels() {
  if (channelsCache) return channelsCache;
  try {
    channelsCache = JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf8"));
  } catch {
    channelsCache = {};
  }
  return channelsCache;
}

function saveChannels() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channelsCache, null, 2));
  } catch (err) {
    console.error("[voiceChannels] échec de la sauvegarde (salons) :", err);
  }
}

/** @returns {string|null} salon générateur configuré pour ce serveur. */
function getHub(guildId) {
  return loadHubs()[guildId] || null;
}

/** @param {string|null} channelId null pour désactiver. */
function setHub(guildId, channelId) {
  const data = loadHubs();
  if (channelId) data[guildId] = channelId;
  else delete data[guildId];
  saveHubs();
}

/** Enregistre un salon temporaire fraîchement créé, avec son propriétaire. */
function registerChannel(channelId, guildId, ownerId) {
  loadChannels()[channelId] = { guildId, ownerId };
  saveChannels();
}

/** @returns {{ guildId: string, ownerId: string }|null} */
function getChannelInfo(channelId) {
  return loadChannels()[channelId] || null;
}

function unregisterChannel(channelId) {
  const data = loadChannels();
  if (!data[channelId]) return false;
  delete data[channelId];
  saveChannels();
  return true;
}

module.exports = { getHub, setHub, registerChannel, getChannelInfo, unregisterChannel };
