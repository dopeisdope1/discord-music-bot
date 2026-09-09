const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("../jsonFile");

// Même patron que utils/accessStore.js et utils/prefixStore.js : DATA_DIR
// pointe vers un Volume Railway monté, sans quoi les octrois seraient
// perdus à chaque redéploiement.
//
// Contrairement à accessStore.js (portées globales sys/banall/clear/salon,
// délibérément inchangées — voir le plan), ce fichier est PAR SERVEUR :
// { [guildId]: { roleGrants: { [roleId]: [clé, ...] }, userGrants: { [userId]: [clé, ...] } } }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "permissions.json");

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
    console.error("[permissions/store] échec de la sauvegarde :", err);
  }
}

function guildData(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { roleGrants: {}, userGrants: {}, exclusiveRoles: [] };
  if (!data[guildId].roleGrants) data[guildId].roleGrants = {};
  if (!data[guildId].userGrants) data[guildId].userGrants = {};
  if (!data[guildId].exclusiveRoles) data[guildId].exclusiveRoles = [];
  return data[guildId];
}

const getRoleGrants = (guildId, roleId) => [...(guildData(guildId).roleGrants[roleId] || [])];
const getUserGrants = (guildId, userId) => [...(guildData(guildId).userGrants[userId] || [])];

/** Remplace intégralement les clés accordées à un rôle (édition en un envoi depuis le panel). */
function setRoleGrants(guildId, roleId, keys) {
  const data = guildData(guildId);
  if (keys.length) data.roleGrants[roleId] = [...new Set(keys)];
  else delete data.roleGrants[roleId];
  save();
}

function grantToUser(guildId, userId, key) {
  const data = guildData(guildId);
  const list = data.userGrants[userId] || (data.userGrants[userId] = []);
  if (list.includes(key)) return false;
  list.push(key);
  save();
  return true;
}

function revokeFromUser(guildId, userId, key) {
  const data = guildData(guildId);
  const list = data.userGrants[userId];
  const index = list ? list.indexOf(key) : -1;
  if (index === -1) return false;
  list.splice(index, 1);
  if (!list.length) delete data.userGrants[userId];
  save();
  return true;
}

/** Retire TOUS les octrois individuels d'un membre sur un serveur (départ, nettoyage). @returns {boolean} */
function clearUserGrants(guildId, userId) {
  const data = guildData(guildId);
  if (!data.userGrants[userId]) return false;
  delete data.userGrants[userId];
  save();
  return true;
}

/** Rôles ayant au moins une clé accordée sur ce serveur, avec leurs clés. */
function listRoleGrants(guildId) {
  return Object.entries(guildData(guildId).roleGrants).filter(([, keys]) => keys.length);
}

/** Membres ayant un octroi individuel sur ce serveur, avec leurs clés. */
function listUserGrants(guildId) {
  return Object.entries(guildData(guildId).userGrants).filter(([, keys]) => keys.length);
}

// "Exclusif" : simple étiquette posée par l'admin sur un rôle depuis le
// panel — aucun effet sur le calcul des permissions (utils/permissions/
// engine.js::can n'y touche pas), juste un marqueur affiché à part pour
// distinguer d'un coup d'œil les rôles "à part" (ex. un rôle dédié à une
// seule permission précise) des rôles cumulés normalement.
const isRoleExclusive = (guildId, roleId) => guildData(guildId).exclusiveRoles.includes(roleId);

function setRoleExclusive(guildId, roleId, exclusive) {
  const data = guildData(guildId);
  const has = data.exclusiveRoles.includes(roleId);
  if (exclusive && !has) data.exclusiveRoles.push(roleId);
  else if (!exclusive && has) data.exclusiveRoles = data.exclusiveRoles.filter((id) => id !== roleId);
  else return;
  save();
}

const listExclusiveRoles = (guildId) => [...guildData(guildId).exclusiveRoles];

module.exports = {
  getRoleGrants,
  getUserGrants,
  setRoleGrants,
  grantToUser,
  revokeFromUser,
  clearUserGrants,
  listRoleGrants,
  listUserGrants,
  isRoleExclusive,
  setRoleExclusive,
  listExclusiveRoles,
};
