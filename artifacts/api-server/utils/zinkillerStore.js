const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Ban PERSISTANT ("-zinkiller") — voir utils/zinkillerCommands.js. Une entrée
// ici vaut "doit rester banni" : si quelqu'un le débannit autrement que par
// -unzinkiller (Discord natif, un autre bot...), index.js le re-bannit tout
// seul (voir l'écouteur guildBanRemove). -unzinkiller retire l'entrée AVANT
// de débannir, pour que ce même écouteur ne se re-déclenche pas sur son
// propre débannissement.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "zinkiller.json");

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
    console.error("[zinkillerStore] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  return data[guildId];
}

function isZinkilled(guildId, userId) {
  return Boolean(guildEntry(guildId)[userId]);
}

/** @param {{ reason?: string, moderatorId: string, preuve?: string, grade?: string, note?: string, expiresAt?: number }} info */
function add(guildId, userId, info) {
  guildEntry(guildId)[userId] = {
    reason: info.reason || null,
    moderatorId: info.moderatorId,
    preuve: info.preuve || null,
    grade: info.grade || null,
    note: info.note || null,
    expiresAt: info.expiresAt || null,
    at: Date.now(),
  };
  save();
}

/** @returns {{ guildId: string, userId: string, reason: string|null, moderatorId: string, preuve: string|null, grade: number|null, expiresAt: number, at: number }[]} entrées temporaires arrivées à échéance, tous serveurs confondus. */
function getExpired() {
  const data = load();
  const maintenant = Date.now();
  const expirees = [];
  for (const [guildId, entries] of Object.entries(data)) {
    for (const [userId, info] of Object.entries(entries)) {
      if (userId === "__config") continue;
      if (info.expiresAt && info.expiresAt <= maintenant) expirees.push({ guildId, userId, ...info });
    }
  }
  return expirees;
}

/** @returns {object|null} l'entrée retirée, ou null si elle n'existait pas. */
function remove(guildId, userId) {
  const entry = guildEntry(guildId);
  const removed = entry[userId] || null;
  if (removed) {
    delete entry[userId];
    save();
  }
  return removed;
}

/** @returns {{ userId: string, reason: string|null, moderatorId: string, preuve: string|null, grade: number|null, at: number }[]} */
function list(guildId) {
  return Object.entries(guildEntry(guildId))
    .filter(([key]) => key !== "__config")
    .map(([userId, info]) => ({ userId, ...info }));
}

function get(guildId, userId) {
  return guildEntry(guildId)[userId] || null;
}

function getConfig(guildId) {
  const cfg = guildEntry(guildId).__config || {};
  return { enabled: cfg.enabled !== false };
}

function setEnabled(guildId, enabled) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId].__config) data[guildId].__config = {};
  data[guildId].__config.enabled = enabled;
  save();
}

module.exports = { isZinkilled, add, remove, list, get, getExpired, getConfig, setEnabled };
