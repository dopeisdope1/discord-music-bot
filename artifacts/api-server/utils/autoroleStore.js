const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Rôles attribués automatiquement à l'arrivée d'un membre (voir &panel >
// Membres et index.js, listener "guildMemberAdd"). Une whitelist de rôles
// DÉJÀ existants, pas une création — même principe que
// utils/classRolesStore.js.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "autoroles.json");

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
    console.error("[autoroleStore] échec de la sauvegarde :", err);
  }
}

function guildList(guildId) {
  const data = load();
  if (!Array.isArray(data[guildId])) data[guildId] = [];
  return data[guildId];
}

/** @returns {string[]} IDs des rôles auto-attribués, dans l'ordre d'ajout. */
function getRoleIds(guildId) {
  return [...guildList(guildId)];
}

/** Remplace la liste complète (utilisé par le sélecteur multi-rôle du panel). */
function setRoleIds(guildId, roleIds) {
  const data = load();
  data[guildId] = [...new Set(roleIds)];
  save();
}

/** @returns {boolean} false si le rôle était déjà dans la liste. */
function addRole(guildId, roleId) {
  const list = guildList(guildId);
  if (list.includes(roleId)) return false;
  list.push(roleId);
  save();
  return true;
}

/** @returns {boolean} false si le rôle n'était pas dans la liste. */
function removeRole(guildId, roleId) {
  const list = guildList(guildId);
  const index = list.indexOf(roleId);
  if (index === -1) return false;
  list.splice(index, 1);
  save();
  return true;
}

module.exports = { getRoleIds, setRoleIds, addRole, removeRole };
