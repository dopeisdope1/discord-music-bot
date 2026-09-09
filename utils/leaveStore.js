const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Message de départ à la sortie d'un membre (voir &panel > Bienvenue et
// index.js, listener "guildMemberRemove") — même structure que
// utils/welcomeStore.js, fichier séparé (aucun rapport de données avec
// l'arrivée : un serveur peut vouloir l'un sans l'autre).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "leave.json");

const DEFAULT_AUTO_DELETE_SECONDS = 30;

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
    console.error("[leaveStore] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  const entry = data[guildId];
  if (entry.channelId === undefined) entry.channelId = null;
  if (typeof entry.autoDeleteSeconds !== "number") entry.autoDeleteSeconds = DEFAULT_AUTO_DELETE_SECONDS;
  if (!Array.isArray(entry.messages)) entry.messages = [];
  return entry;
}

/** @returns {{ channelId: string|null, autoDeleteSeconds: number, messages: string[] }} */
function getConfig(guildId) {
  const entry = guildEntry(guildId);
  return { channelId: entry.channelId, autoDeleteSeconds: entry.autoDeleteSeconds, messages: [...entry.messages] };
}

function setChannel(guildId, channelId) {
  guildEntry(guildId).channelId = channelId || null;
  save();
}

/** @param {number} seconds 0 = ne s'efface jamais. */
function setAutoDelete(guildId, seconds) {
  guildEntry(guildId).autoDeleteSeconds = seconds;
  save();
}

function addMessage(guildId, text) {
  guildEntry(guildId).messages.push(text);
  save();
}

/** @returns {boolean} false si l'index n'existe pas. */
function removeMessage(guildId, index) {
  const list = guildEntry(guildId).messages;
  if (index < 0 || index >= list.length) return false;
  list.splice(index, 1);
  save();
  return true;
}

/** @returns {string|null} un message choisi au hasard, ou null si aucun n'est configuré. */
function pickRandomMessage(guildId) {
  const { messages } = getConfig(guildId);
  if (!messages.length) return null;
  return messages[Math.floor(Math.random() * messages.length)];
}

module.exports = { getConfig, setChannel, setAutoDelete, addMessage, removeMessage, pickRandomMessage };
