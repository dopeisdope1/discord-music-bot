const fs = require("fs");
const path = require("path");

// Salons vocaux temporaires : un salon "générateur" (le hub) configuré par
// serveur ; le rejoindre crée un salon vocal personnel et y déplace le
// membre, supprimé automatiquement quand il se vide (voir index.js,
// listener "voiceStateUpdate" dédié, séparé de celui du player musique).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const HUB_FILE = path.join(DATA_DIR, "voiceHub.json");
const CHANNELS_FILE = path.join(DATA_DIR, "tempVoiceChannels.json");
// Réglages additionnels du voicehub (catégorie de destination des salons
// créés à la volée, modèles de nom) — fichier SÉPARÉ de voiceHub.json pour
// ne pas toucher au format existant (guildId -> id de salon brut) et éviter
// toute migration.
const CONFIG_FILE = path.join(DATA_DIR, "voiceHubConfig.json");

let hubCache = null;
let channelsCache = null;
let configCache = null;

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

function loadConfig() {
  if (configCache) return configCache;
  try {
    configCache = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    configCache = {};
  }
  return configCache;
}

function saveConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configCache, null, 2));
  } catch (err) {
    console.error("[voiceChannels] échec de la sauvegarde (config) :", err);
  }
}

const DEFAULT_VOICE_NAME_TEMPLATE = "Salon de {pseudo}";

/**
 * @returns {{ spawnCategoryId: string|null, panelChannelId: string|null, voiceNameTemplate: string }}
 */
function getHubConfig(guildId) {
  const entry = loadConfig()[guildId] || {};
  return {
    spawnCategoryId: entry.spawnCategoryId || null,
    panelChannelId: entry.panelChannelId || null,
    voiceNameTemplate: entry.voiceNameTemplate || DEFAULT_VOICE_NAME_TEMPLATE,
  };
}

/** @param {string|null} categoryId null pour revenir au comportement par défaut (même catégorie que le générateur). */
function setSpawnCategory(guildId, categoryId) {
  const data = loadConfig();
  data[guildId] = { ...data[guildId], spawnCategoryId: categoryId || null };
  saveConfig();
}

/**
 * Salon texte UNIQUE et permanent qui porte le panneau de contrôle partagé
 * (boutons Ouvrir/Fermer/Ajouter/Retirer/Renommer/Transférer) — un clic y
 * agit sur le salon vocal où la personne est CONNECTÉE au moment du clic
 * (voir utils/serverAdminCommands.js::handleVoiceControlInteraction), pas
 * sur un salon texte compagnon créé puis détruit à chaque salon vocal.
 * @param {string|null} channelId
 */
function setPanelChannel(guildId, channelId) {
  const data = loadConfig();
  data[guildId] = { ...data[guildId], panelChannelId: channelId || null };
  saveConfig();
}

function setNameTemplates(guildId, { voiceNameTemplate }) {
  const data = loadConfig();
  data[guildId] = { ...data[guildId], voiceNameTemplate: voiceNameTemplate || DEFAULT_VOICE_NAME_TEMPLATE };
  saveConfig();
}

/** Applique un modèle de nom ("Salon de {pseudo}") ; sans le jeton, le pseudo est ajouté à la fin. */
function formatTemplate(template, pseudo) {
  const applied = template.includes("{pseudo}") ? template.replace(/\{pseudo\}/g, pseudo) : `${template} ${pseudo}`;
  return applied.slice(0, 100);
}

module.exports = {
  getHub,
  setHub,
  registerChannel,
  getChannelInfo,
  unregisterChannel,
  getHubConfig,
  setSpawnCategory,
  setPanelChannel,
  setNameTemplates,
  formatTemplate,
  DEFAULT_VOICE_NAME_TEMPLATE,
};
