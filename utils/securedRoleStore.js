const fs = require("fs");
const path = require("path");

// Rôles "sécurisés" (`secur`) : si l'un d'eux est donné à un membre par
// quelqu'un qui n'est pas owner anti-nuke, utils/antiNuke.js le retire
// automatiquement — évite qu'un rôle admin/staff soit distribué en douce par
// un compte compromis ou un modérateur peu scrupuleux.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "securedRoles.json");

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
    console.error("[securedRoleStore] échec de la sauvegarde :", err);
  }
}

function getSecuredRoles(guildId) {
  return [...(load()[guildId] || [])];
}

function isSecuredRole(guildId, roleId) {
  return getSecuredRoles(guildId).includes(roleId);
}

function addSecuredRole(guildId, roleId) {
  const data = load();
  if (!data[guildId]) data[guildId] = [];
  if (!data[guildId].includes(roleId)) data[guildId].push(roleId);
  save();
}

function removeSecuredRole(guildId, roleId) {
  const data = load();
  if (!data[guildId]) return;
  data[guildId] = data[guildId].filter((id) => id !== roleId);
  save();
}

function getRawGuildData(guildId) {
  return load()[guildId] || [];
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = {
  getSecuredRoles,
  isSecuredRole,
  addSecuredRole,
  removeSecuredRole,
  getRawGuildData,
  hydrateFromRemote,
};
