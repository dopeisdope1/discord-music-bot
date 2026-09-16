const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Échelle de grades ordonnée par serveur : position 0 = grade le plus bas,
// dernière position = le plus haut. Distincte de &derank (utils/
// moderationExtra.js, retire TOUS les rôles) — voir utils/
// rankLadderCommands.js ("&promote"/"&demote", "&rank"/"&derank" existant
// déjà pour autre chose : niveaux/XP et retrait de rôles).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "rankLadder.json");

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
    console.error("[rankLadderStore] échec de la sauvegarde :", err);
  }
}

/** @returns {string[]} identifiants de rôle, du grade le plus bas au plus haut. */
function getLadder(guildId) {
  const data = load();
  return Array.isArray(data[guildId]) ? [...data[guildId]] : [];
}

/** Ajoute un rôle au sommet de l'échelle (nouveau grade le plus haut). @returns {boolean} false s'il y était déjà. */
function addRole(guildId, roleId) {
  const data = load();
  if (!Array.isArray(data[guildId])) data[guildId] = [];
  if (data[guildId].includes(roleId)) return false;
  data[guildId].push(roleId);
  save();
  return true;
}

/** @returns {boolean} false si le rôle n'était pas dans l'échelle. */
function removeRole(guildId, roleId) {
  const data = load();
  const list = data[guildId] || [];
  const index = list.indexOf(roleId);
  if (index === -1) return false;
  list.splice(index, 1);
  save();
  return true;
}

module.exports = { getLadder, addRole, removeRole };
