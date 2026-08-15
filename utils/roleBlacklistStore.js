const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "roleBlacklist.json");

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
    console.error("[roleBlacklistStore] échec de la sauvegarde :", err);
  }
}

// Toujours renormalisé — voir le commentaire équivalent dans muteStore.js
// (un {} vide venu du salon "zinki-config" ne doit pas être pris pour "déjà initialisé").
function ensureGuild(guildId) {
  const data = load();
  const defaults = { roles: [], members: [] };
  data[guildId] = { ...defaults, ...data[guildId] };
  return data[guildId];
}

function addRole(guildId, roleId) {
  const g = ensureGuild(guildId);
  if (!g.roles.includes(roleId)) g.roles.push(roleId);
  save();
}

function removeRole(guildId, roleId) {
  const g = ensureGuild(guildId);
  g.roles = g.roles.filter((r) => r !== roleId);
  save();
}

function isRoleBlacklisted(guildId, roleId) {
  return ensureGuild(guildId).roles.includes(roleId);
}

function listRoles(guildId) {
  return [...ensureGuild(guildId).roles];
}

function addMember(guildId, userId) {
  const g = ensureGuild(guildId);
  if (!g.members.includes(userId)) g.members.push(userId);
  save();
}

function removeMember(guildId, userId) {
  const g = ensureGuild(guildId);
  g.members = g.members.filter((m) => m !== userId);
  save();
}

function isMemberBlacklisted(guildId, userId) {
  return ensureGuild(guildId).members.includes(userId);
}

function listMembers(guildId) {
  return [...ensureGuild(guildId).members];
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
  addRole,
  removeRole,
  isRoleBlacklisted,
  listRoles,
  addMember,
  removeMember,
  isMemberBlacklisted,
  listMembers,
  getRawGuildData,
  hydrateFromRemote,
};
