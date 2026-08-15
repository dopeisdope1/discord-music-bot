const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "channelBlacklist.json");
const GLOBAL_SCOPE = "*";

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
    console.error("[channelBlacklistStore] échec de la sauvegarde :", err);
  }
}

function ensureGuild(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  return data[guildId];
}

function add(guildId, scope, channelId) {
  const g = ensureGuild(guildId);
  if (!g[scope]) g[scope] = [];
  if (!g[scope].includes(channelId)) g[scope].push(channelId);
  save();
}

function remove(guildId, scope, channelId) {
  const g = ensureGuild(guildId);
  if (!g[scope]) return;
  g[scope] = g[scope].filter((c) => c !== channelId);
  save();
}

function list(guildId, scope) {
  return [...(ensureGuild(guildId)[scope] || [])];
}

function isBlacklisted(guildId, commandName, channelId) {
  const g = ensureGuild(guildId);
  return Boolean(g[GLOBAL_SCOPE]?.includes(channelId) || g[commandName]?.includes(channelId));
}

function getRawGuildData(guildId) {
  return load()[guildId] || {};
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = { GLOBAL_SCOPE, add, remove, list, isBlacklisted, getRawGuildData, hydrateFromRemote };
