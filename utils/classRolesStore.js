const fs = require("fs");
const path = require("path");

// Rôles éligibles comme "classe" pour le sélecteur &class (voir utils/classSelect.js).
// Aucune classe n'est codée en dur : un admin whiteliste des rôles DÉJÀ
// existants sur le serveur via &classes add/del, et c'est cette liste qui
// alimente dynamiquement le menu — ajouter/retirer une classe ne touche
// jamais ce fichier de code.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "classRoles.json");

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
    console.error("[classRolesStore] échec de la sauvegarde :", err);
  }
}

function guildList(guildId) {
  const data = load();
  if (!Array.isArray(data[guildId])) data[guildId] = [];
  return data[guildId];
}

/** @returns {string[]} IDs des rôles éligibles, dans l'ordre d'ajout. */
function getRoleIds(guildId) {
  return [...guildList(guildId)];
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

module.exports = { getRoleIds, addRole, removeRole };
