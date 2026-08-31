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

/**
 * Enregistre un salon temporaire fraîchement créé, avec son propriétaire et le
 * salon texte qui l'accompagne (celui qui porte le panneau de contrôle).
 * @param {string|null} [textChannelId] null si le salon texte n'a pas pu être créé
 */
function registerChannel(channelId, guildId, ownerId, textChannelId = null) {
  loadChannels()[channelId] = { guildId, ownerId, textChannelId };
  saveChannels();
}

/** @returns {{ guildId: string, ownerId: string, textChannelId?: string|null }|null} */
function getChannelInfo(channelId) {
  return loadChannels()[channelId] || null;
}

/**
 * Salon vocal auquel appartient un salon texte de panneau.
 *
 * C'est ce qui permet aux boutons de fonctionner depuis le salon TEXTE : sans
 * ça, le panneau ne saurait pas sur quel salon vocal agir, puisqu'on ne clique
 * plus depuis le vocal lui-même.
 *
 * @returns {string|null} identifiant du salon vocal
 */
function getVoiceChannelForText(textChannelId) {
  const data = loadChannels();
  return Object.keys(data).find((voiceId) => data[voiceId].textChannelId === textChannelId) || null;
}

function unregisterChannel(channelId) {
  const data = loadChannels();
  if (!data[channelId]) return false;
  delete data[channelId];
  saveChannels();
  return true;
}

module.exports = { getHub, setHub, registerChannel, getChannelInfo, getVoiceChannelForText, unregisterChannel };
