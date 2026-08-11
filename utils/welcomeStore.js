const fs = require("fs");
const path = require("path");
const { WELCOME_MESSAGES: DEFAULT_MESSAGES } = require("./welcomeMessages");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. La config est aussi sauvegardée dans le salon Discord
// partagé "zinki-config" (voir utils/configChannel.js), qui lui survit aux
// redéploiements.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "welcome.json");

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
    console.error("[welcomeStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @param {string} channelId
 */
function setWelcomeChannel(guildId, channelId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId].channelId = channelId;
  save();
}

/**
 * @param {string} guildId
 * @returns {string|null}
 */
function getWelcomeChannel(guildId) {
  return load()[guildId]?.channelId || null;
}

/**
 * @param {string} guildId
 * @returns {string[]}
 */
function getWelcomeMessages(guildId) {
  return load()[guildId]?.messages || [];
}

/**
 * @param {string} guildId
 * @param {string} text
 * @returns {number} numéro (1-based) du message ajouté, pour la confirmation
 */
function addWelcomeMessage(guildId, text) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId].messages) data[guildId].messages = [];
  data[guildId].messages.push(text);
  save();
  return data[guildId].messages.length;
}

/**
 * @param {string} guildId
 * @param {number} index 1-based, comme affiché par `listbienvenue`
 * @returns {string|null} le message retiré, ou null si le numéro est invalide
 */
function removeWelcomeMessage(guildId, index) {
  const data = load();
  const messages = data[guildId]?.messages || [];
  if (!Number.isInteger(index) || index < 1 || index > messages.length) return null;
  const [removed] = messages.splice(index - 1, 1);
  save();
  return removed;
}

/**
 * Message de bienvenue à afficher : pioche dans la liste personnalisée du
 * serveur si elle n'est pas vide, sinon dans la liste par défaut (voir
 * utils/welcomeMessages.js).
 * @param {string} guildId
 * @returns {string}
 */
function getRandomWelcomeMessage(guildId) {
  const custom = getWelcomeMessages(guildId);
  const pool = custom.length ? custom : DEFAULT_MESSAGES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Valeurs brutes d'un serveur, utilisé par utils/configChannel.js pour
 * sauvegarder/restaurer via Discord.
 * @param {string} guildId
 */
function getRawGuildData(guildId) {
  return load()[guildId] || {};
}

/**
 * Recharge la config de bienvenue d'un serveur depuis une source externe
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

module.exports = {
  setWelcomeChannel,
  getWelcomeChannel,
  getWelcomeMessages,
  addWelcomeMessage,
  removeWelcomeMessage,
  getRandomWelcomeMessage,
  getRawGuildData,
  hydrateFromRemote,
};
