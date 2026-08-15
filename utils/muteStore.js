const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "mute.json");

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
    console.error("[muteStore] échec de la sauvegarde :", err);
  }
}

// Toujours renormalisé (defaults en dessous, valeurs existantes par-dessus)
// plutôt qu'un simple "si absent, initialise" — un aller-retour par le salon
// "zinki-config" peut ramener un objet vide {} pour un serveur jamais
// vraiment configuré (voir utils/configChannel.js#getRawGuildData), et un
// simple `if (!data[guildId])` prendrait ce {} pour "déjà initialisé" sans
// les champs requis (reasons, activeMutes...), plantant au premier accès.
function ensureGuild(guildId) {
  const data = load();
  const defaults = { mode: "timeout", muteRoleId: null, allowCustomReasons: true, reasons: [], activeMutes: {} };
  data[guildId] = { ...defaults, ...data[guildId] };
  return data[guildId];
}

function getConfig(guildId) {
  const g = ensureGuild(guildId);
  return { mode: g.mode, muteRoleId: g.muteRoleId, allowCustomReasons: g.allowCustomReasons };
}

function setMode(guildId, mode, muteRoleId = null) {
  const g = ensureGuild(guildId);
  g.mode = mode;
  g.muteRoleId = muteRoleId;
  save();
}

function setAllowCustomReasons(guildId, allow) {
  ensureGuild(guildId).allowCustomReasons = Boolean(allow);
  save();
}

function addReason(guildId, reason) {
  const g = ensureGuild(guildId);
  if (!g.reasons.includes(reason)) g.reasons.push(reason);
  save();
}

function removeReason(guildId, reason) {
  const g = ensureGuild(guildId);
  g.reasons = g.reasons.filter((r) => r !== reason);
  save();
}

function listReasons(guildId) {
  return [...ensureGuild(guildId).reasons];
}

function setActive(guildId, userId, { reason, mutedBy, expiresAt }) {
  const g = ensureGuild(guildId);
  g.activeMutes[userId] = { reason: reason || null, mutedBy, mutedAt: Date.now(), expiresAt: expiresAt || null };
  save();
}

function clearActive(guildId, userId) {
  const g = ensureGuild(guildId);
  delete g.activeMutes[userId];
  save();
}

function getActive(guildId, userId) {
  return ensureGuild(guildId).activeMutes[userId] || null;
}

function listActive(guildId) {
  const g = ensureGuild(guildId);
  return Object.entries(g.activeMutes).map(([userId, entry]) => ({ userId, ...entry }));
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

module.exports = {
  getConfig,
  setMode,
  setAllowCustomReasons,
  addReason,
  removeReason,
  listReasons,
  setActive,
  clearActive,
  getActive,
  listActive,
  getRawGuildData,
  hydrateFromRemote,
};
