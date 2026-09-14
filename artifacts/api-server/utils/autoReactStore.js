const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Réactions automatiques par salon (&autoreact) — liste d'émojis par salon,
// ajoutés à chaque nouveau message de ce salon.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "autoReact.json");

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
    console.error("[autoReactStore] échec de la sauvegarde :", err);
  }
}

/** @returns {string[]} émojis configurés pour ce salon */
function getForChannel(channelId) {
  return [...(load()[channelId] || [])];
}

/** @returns {boolean} false si déjà présent */
function add(channelId, emoji) {
  const data = load();
  if (!data[channelId]) data[channelId] = [];
  if (data[channelId].includes(emoji)) return false;
  data[channelId].push(emoji);
  save();
  return true;
}

/** @returns {boolean} false si absent */
function remove(channelId, emoji) {
  const data = load();
  if (!data[channelId]?.includes(emoji)) return false;
  data[channelId] = data[channelId].filter((e) => e !== emoji);
  if (!data[channelId].length) delete data[channelId];
  save();
  return true;
}

/** @returns {{ channelId: string, emojis: string[] }[]} tous les salons configurés sur un serveur */
function listForGuild(guild) {
  const data = load();
  return Object.entries(data)
    .filter(([channelId]) => guild.channels.cache.has(channelId))
    .map(([channelId, emojis]) => ({ channelId, emojis }));
}

module.exports = { getForChannel, add, remove, listForGuild };
