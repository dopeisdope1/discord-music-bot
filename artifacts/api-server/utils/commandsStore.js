const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "commands.json");

let cache = null;
function load() {
  if (cache) return cache;
  try {
    cache = lireJson(DATA_FILE);
  } catch {
    cache = {};
  }
  cache.global = cache.global || {};
  cache.guilds = cache.guilds || {};
  return cache;
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireJson(DATA_FILE, cache);
  } catch (err) {
    console.error("[commandsStore] echec de la sauvegarde :", err);
  }
}

function isEnabledGlobally(name) {
  return load().global[name] !== false;
}
function isEnabledForGuild(name, guildId) {
  const data = load();
  if (guildId && data.guilds[guildId] && data.guilds[guildId][name] !== undefined) {
    return data.guilds[guildId][name] !== false;
  }
  return isEnabledGlobally(name);
}
function setGlobalEnabled(name, enabled) {
  const data = load();
  if (enabled) delete data.global[name];
  else data.global[name] = false;
  save();
}
function setGuildEnabled(guildId, name, enabled) {
  const data = load();
  data.guilds[guildId] = data.guilds[guildId] || {};
  if (enabled) delete data.guilds[guildId][name];
  else data.guilds[guildId][name] = false;
  save();
}

module.exports = { isEnabledGlobally, isEnabledForGuild, setGlobalEnabled, setGuildEnabled };
