const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "logChannels.json");

// Catégories affichées dans `.panel` > Logs, alignées sur les rubriques de `.help`.
const LOG_CATEGORIES = {
  moderation: { key: "moderation", label: "Logs modération", description: "`.clear`, `.ban`, `.unban`" },
  salon: { key: "salon", label: "Logs salon", description: "`.renew`, `.hide`, `.unhide`, `.lock`, `.unlock`" },
  roles: { key: "roles", label: "Logs rôles", description: "`.massrole`" },
};

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
    console.error("[logStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @returns {{ [category: string]: string }} catégorie -> ID de salon
 */
function getLogChannels(guildId) {
  const data = load();
  return { ...(data[guildId] || {}) };
}

/**
 * @param {string} guildId
 * @param {string} category
 * @returns {string|null}
 */
function getLogChannelId(guildId, category) {
  return getLogChannels(guildId)[category] || null;
}

/**
 * @param {string} guildId
 * @param {string} category
 * @param {string} channelId
 */
function setLogChannel(guildId, category, channelId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][category] = channelId;
  save();
}

module.exports = { getLogChannels, getLogChannelId, setLogChannel, LOG_CATEGORIES };
