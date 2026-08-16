const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "addroleConfig.json");

// Valeurs par défaut : bloque l'ajout/retrait en
// masse de rôles porteurs de permissions sensibles.
const DEFAULT_BLOCKED = ["KickMembers", "BanMembers", "Administrator", "ManageChannels", "ManageGuild", "ManageRoles"];

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
    console.error("[addroleConfigStore] échec de la sauvegarde :", err);
  }
}

// Toujours renormalisé — voir le commentaire équivalent dans muteStore.js
// (un {} vide venu du salon "zinki-config" ne doit pas être pris pour "déjà initialisé").
function ensureGuild(guildId) {
  const data = load();
  const defaults = { blockedPermissions: [...DEFAULT_BLOCKED], rolesPerAction: 1 };
  data[guildId] = { ...defaults, ...data[guildId] };
  return data[guildId];
}

function getConfig(guildId) {
  const g = ensureGuild(guildId);
  return { blockedPermissions: [...g.blockedPermissions], rolesPerAction: g.rolesPerAction };
}

function setBlockedPermissions(guildId, permissionNames) {
  ensureGuild(guildId).blockedPermissions = [...permissionNames];
  save();
}

function resetBlockedPermissions(guildId) {
  setBlockedPermissions(guildId, DEFAULT_BLOCKED);
}

function setRolesPerAction(guildId, count) {
  ensureGuild(guildId).rolesPerAction = count;
  save();
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
  DEFAULT_BLOCKED,
  getConfig,
  setBlockedPermissions,
  resetBlockedPermissions,
  setRolesPerAction,
  getRawGuildData,
  hydrateFromRemote,
};
