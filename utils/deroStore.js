const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Dero automatique : les rôles listés reçoivent Voir le salon/Envoyer des
// messages/Se connecter sur CHAQUE nouveau salon créé sur le serveur, sans
// action manuelle (voir index.js, listener "channelCreate", et
// utils/serverAdminCommands.js pour la commande &dero).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "dero.json");

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
    console.error("[deroStore] échec de la sauvegarde :", err);
  }
}

/** @returns {string[]} IDs des rôles actuellement configurés pour ce serveur. */
function getRoles(guildId) {
  return [...(load()[guildId] || [])];
}

/** @returns {boolean} false si le rôle y était déjà. */
function addRole(guildId, roleId) {
  const data = load();
  if (!data[guildId]) data[guildId] = [];
  if (data[guildId].includes(roleId)) return false;
  data[guildId].push(roleId);
  save();
  return true;
}

/** @returns {boolean} false si le rôle n'y était pas. */
function removeRole(guildId, roleId) {
  const data = load();
  const list = data[guildId];
  const index = list ? list.indexOf(roleId) : -1;
  if (index === -1) return false;
  list.splice(index, 1);
  if (!list.length) delete data[guildId];
  save();
  return true;
}

module.exports = { getRoles, addRole, removeRole };
