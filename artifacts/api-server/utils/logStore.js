const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ecrireJson, lireJson } = require("./jsonFile");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "panelLogs.json");
const MAX_ENTRIES_PER_GUILD = 1000;

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
    console.error("[logStore] echec de la sauvegarde :", err);
  }
}

function record(guildId, { type = "event", level = "info", message, metadata = null } = {}) {
  if (!guildId || !message) return null;
  const data = load();
  if (!Array.isArray(data[guildId])) data[guildId] = [];
  const entry = {
    id: crypto.randomUUID(),
    guildId,
    level,
    type,
    message,
    metadata: metadata || {},
    createdAt: new Date().toISOString(),
  };
  data[guildId].unshift(entry);
  if (data[guildId].length > MAX_ENTRIES_PER_GUILD) data[guildId].length = MAX_ENTRIES_PER_GUILD;
  save();
  return entry;
}

function query(filters = {}) {
  const { guildId, type, level, search, from, to, limit = 50 } = filters;
  const data = load();
  const all = guildId ? data[guildId] || [] : Object.values(data).flat();
  const fromT = from ? new Date(from).getTime() : null;
  const toT = to ? new Date(to).getTime() : null;
  const needle = search ? String(search).toLowerCase() : null;

  const results = all
    .filter((e) => !type || e.type === type)
    .filter((e) => !level || e.level === level)
    .filter((e) => fromT == null || new Date(e.createdAt).getTime() >= fromT)
    .filter((e) => toT == null || new Date(e.createdAt).getTime() <= toT)
    .filter((e) => !needle || e.message.toLowerCase().includes(needle) || JSON.stringify(e.metadata).toLowerCase().includes(needle))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return limit ? results.slice(0, Number(limit)) : results;
}

module.exports = { record, query };
